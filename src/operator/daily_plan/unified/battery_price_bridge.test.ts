import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planBatteryPriceBridge, type PriceBridgeInput } from "./battery_price_bridge";
import { allocateUnifiedDayPlan } from "./allocate";
import { golden002Input } from "./fixtures";

const START = Date.parse("2026-11-09T05:00:00Z");
function fixture(): PriceBridgeInput {
	return {
		nowMs: START, socPct: 20, capacityKwh: 10, maxChargePowerW: 4500, minSocPct: 10, maxSocPct: 100,
		nightKwh: 3.2, pvConfidencePct: 80, chargeEfficiency: 0.95,
		dischargeEfficiency: 0.95, wearCtPerKwh: 5, priceSource: "dynamic_tariff", mode: "balanced",
		slots: Array.from({ length: 192 }, (_, i) => {
			const hour = (5 + i / 4) % 24;
			const day = Math.floor((5 + i / 4) / 24);
			const pv = day === 0 && hour >= 8 && hour < 16 ? 7 / 32 :
				day === 1 && hour >= 8 && hour < 16 ? 15 / 32 : 0;
			return {
				startIso: new Date(START + i * 900_000).toISOString(),
				endIso: new Date(START + (i + 1) * 900_000).toISOString(),
				pvKwh: pv, houseKwh: day === 0 && hour >= 8 && hour < 16 ? 0.18 : 0.09,
				committedKwh: 0,
				importCt: day === 0 && hour >= 18 && hour < 20 ? 80 : day === 0 && hour >= 12 && hour < 13 ? 25 : 50,
				gridAllowed: true,
			};
		}),
	};
}

describe("Batterie-Preisbrücke am Nebeltag", () => {
	it("übernimmt Netzfenster und dynamisches Ziel in die ausführbare Tages-Allocation", () => {
		const f = fixture();
		const base = golden002Input();
		const slots = f.slots.map(s => ({ startIso: s.startIso, endIso: s.endIso }));
		const input = {
			...base,
			time: { ...base.time, nowIso: new Date(f.nowMs).toISOString(), horizonStartIso: slots[0]!.startIso,
				horizonEndIso: slots.at(-1)!.endIso, slots },
			pv: { ...base.pv, slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
				energyKwh: s.pvKwh, forecastPowerW: s.pvKwh! * 4000, observedPowerW: null })) },
			houseLoad: { ...base.houseLoad, slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
				energyKwh: s.houseKwh, forecastPowerW: s.houseKwh! * 4000, observedPowerW: null })) },
			prices: { ...base.prices, source: "dynamic_tariff" as const,
				slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
					importCtPerKwh: s.importCt, exportCtPerKwh: 9, gridImportAllowed: true })) },
			battery: { ...base.battery, socPct: 20, nightReserveKwh: 3.2, wearCtPerKwh: 5,
				chargeEfficiency: 0.95, dischargeEfficiency: 0.95,
				requiredChargeEnergyKwh: null }, wallbox: null,
		};
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(plan.batteryPriceBridge?.usable);
		assert.ok(plan.batteryPriceBridge!.targetSocPct! < 100);
		const grid = plan.allocations.filter(a => a.kind === "battery_charge" && a.energySource === "grid");
		assert.ok(grid.length > 0);
		assert.ok(grid.every(a => a.slot.startIso >= plan.batteryPriceBridge!.chargeStartIso! &&
			a.slot.endIso <= plan.batteryPriceBridge!.chargeEndIso!));
		assert.ok(grid.reduce((n, a) => n + a.allocatedEnergyKwh, 0) <= plan.batteryPriceBridge!.gridEnergyKwh + 0.001);
	});
	it("plant nur eine Teil-Netzladung aus sicherem PV-Rest und dynamischem Ziel", () => {
		const result = planBatteryPriceBridge(fixture());
		assert.equal(result.usable, true);
		assert.ok(result.gridEnergyKwh > 0 && result.gridEnergyKwh < 8);
		assert.ok(result.targetSocPct! < 100);
		assert.equal(result.chargeStartIso, "2026-11-09T12:00:00.000Z");
	});
	it("verwechselt PV-Erzeugung ohne Nettoüberschuss nicht mit Batterieladung", () => {
		const input = fixture();
		input.slots = input.slots.map(s => ({ ...s, houseKwh: Math.max(s.houseKwh!, s.pvKwh!) }));
		const result = planBatteryPriceBridge(input);
		assert.equal(result.usable, true);
		assert.ok(result.gridEnergyKwh > 0);
	});
	it("lädt weder bei geschätztem Preis noch bei fehlendem Wirkungsgrad oder mangelndem Vorteil", () => {
		assert.equal(planBatteryPriceBridge({ ...fixture(), priceSource: "price_learning_fallback" }).gridEnergyKwh, 0);
		assert.equal(planBatteryPriceBridge({ ...fixture(), chargeEfficiency: null }).gridEnergyKwh, 0);
		const input = fixture();
		input.slots = input.slots.map(s => ({ ...s, importCt: 50 }));
		assert.equal(planBatteryPriceBridge(input).gridEnergyKwh, 0);
	});
	it("reduziert den Netzanteil durch sicheren PV-Überschuss und erhöht den Puffer bei Nebel", () => {
		const base = fixture();
		const cloudy = planBatteryPriceBridge(base);
		const sunny = planBatteryPriceBridge({ ...base, pvConfidencePct: 95 });
		assert.ok(cloudy.gridEnergyKwh >= sunny.gridEnergyKwh);
		const extraPv = { ...base, slots: base.slots.map((s, i) => i >= 12 && i < 24
			? { ...s, pvKwh: s.pvKwh! + 0.25 } : s) };
		assert.ok(planBatteryPriceBridge(extraPv).gridEnergyKwh < cloudy.gridEnergyKwh);
	});
	it("bewertet verpasste Preisfenster neu und braucht ein technisch ausführbares Ladefenster", () => {
		const input = fixture();
		const afterCheap = { ...input, nowMs: Date.parse("2026-11-09T13:00:00Z") };
		const revised = planBatteryPriceBridge(afterCheap);
		assert.notEqual(revised.chargeStartIso, "2026-11-09T12:00:00.000Z");
		assert.equal(planBatteryPriceBridge({ ...input, maxChargePowerW: 100 }).usable, false);
	});
	it("bleibt für 92, 96 und 100 Viertelstunden an lokalen Zeitwechseln eindeutig", () => {
		for (const [startIso, count] of [
			["2026-03-28T23:00:00Z", 92], // Berlin: Beginn der Sommerzeit
			["2026-11-07T23:00:00Z", 96],
			["2026-10-24T22:00:00Z", 100], // Berlin: Ende der Sommerzeit
		] as const) {
			const input = fixture();
			const start = Date.parse(startIso);
			input.nowMs = start;
			input.slots = input.slots.slice(0, count).map((s, i) => ({ ...s,
				startIso: new Date(start + i * 900_000).toISOString(),
				endIso: new Date(start + (i + 1) * 900_000).toISOString() }));
			assert.equal(input.slots.length, count);
			const result = planBatteryPriceBridge(input);
			assert.ok(result.chargeStartIso == null || Date.parse(result.chargeStartIso) >= input.nowMs);
			assert.ok(result.chargeEndIso == null || Date.parse(result.chargeEndIso) <= Date.parse(input.slots.at(-1)!.endIso));
		}
	});
});

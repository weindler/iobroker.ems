"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const battery_price_bridge_1 = require("./battery_price_bridge");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const START = Date.parse("2026-11-09T05:00:00Z");
function fixture() {
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
(0, node_test_1.describe)("Batterie-Preisbrücke am Nebeltag", () => {
    (0, node_test_1.it)("übernimmt Netzfenster und dynamisches Ziel in die ausführbare Tages-Allocation", () => {
        const f = fixture();
        const base = (0, fixtures_1.golden002Input)();
        const slots = f.slots.map(s => ({ startIso: s.startIso, endIso: s.endIso }));
        const input = {
            ...base,
            time: { ...base.time, nowIso: new Date(f.nowMs).toISOString(), horizonStartIso: slots[0].startIso,
                horizonEndIso: slots.at(-1).endIso, slots },
            pv: { ...base.pv, slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
                    energyKwh: s.pvKwh, forecastPowerW: s.pvKwh * 4000, observedPowerW: null })) },
            houseLoad: { ...base.houseLoad, slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
                    energyKwh: s.houseKwh, forecastPowerW: s.houseKwh * 4000, observedPowerW: null })) },
            prices: { ...base.prices, source: "dynamic_tariff",
                slots: f.slots.map(s => ({ slot: { startIso: s.startIso, endIso: s.endIso },
                    importCtPerKwh: s.importCt, exportCtPerKwh: 9, gridImportAllowed: true })) },
            battery: { ...base.battery, socPct: 20, nightReserveKwh: 3.2, wearCtPerKwh: 5,
                chargeEfficiency: 0.95, dischargeEfficiency: 0.95,
                requiredChargeEnergyKwh: null }, wallbox: null,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.batteryPriceBridge?.usable);
        strict_1.default.ok(plan.batteryPriceBridge.targetSocPct < 100);
        const grid = plan.allocations.filter(a => a.kind === "battery_charge" && a.energySource === "grid");
        strict_1.default.ok(grid.length > 0);
        strict_1.default.ok(grid.every(a => a.slot.startIso >= plan.batteryPriceBridge.chargeStartIso &&
            a.slot.endIso <= plan.batteryPriceBridge.chargeEndIso));
        strict_1.default.ok(grid.reduce((n, a) => n + a.allocatedEnergyKwh, 0) <= plan.batteryPriceBridge.gridEnergyKwh + 0.001);
    });
    (0, node_test_1.it)("plant nur eine Teil-Netzladung aus sicherem PV-Rest und dynamischem Ziel", () => {
        const result = (0, battery_price_bridge_1.planBatteryPriceBridge)(fixture());
        strict_1.default.equal(result.usable, true);
        strict_1.default.ok(result.gridEnergyKwh > 0 && result.gridEnergyKwh < 8);
        strict_1.default.ok(result.targetSocPct < 100);
        strict_1.default.equal(result.chargeStartIso, "2026-11-09T12:00:00.000Z");
    });
    (0, node_test_1.it)("verwechselt PV-Erzeugung ohne Nettoüberschuss nicht mit Batterieladung", () => {
        const input = fixture();
        input.slots = input.slots.map(s => ({ ...s, houseKwh: Math.max(s.houseKwh, s.pvKwh) }));
        const result = (0, battery_price_bridge_1.planBatteryPriceBridge)(input);
        strict_1.default.equal(result.usable, true);
        strict_1.default.ok(result.gridEnergyKwh > 0);
    });
    (0, node_test_1.it)("lädt weder bei geschätztem Preis noch bei fehlendem Wirkungsgrad oder mangelndem Vorteil", () => {
        strict_1.default.equal((0, battery_price_bridge_1.planBatteryPriceBridge)({ ...fixture(), priceSource: "price_learning_fallback" }).gridEnergyKwh, 0);
        strict_1.default.equal((0, battery_price_bridge_1.planBatteryPriceBridge)({ ...fixture(), chargeEfficiency: null }).gridEnergyKwh, 0);
        const input = fixture();
        input.slots = input.slots.map(s => ({ ...s, importCt: 50 }));
        strict_1.default.equal((0, battery_price_bridge_1.planBatteryPriceBridge)(input).gridEnergyKwh, 0);
    });
    (0, node_test_1.it)("reduziert den Netzanteil durch sicheren PV-Überschuss und erhöht den Puffer bei Nebel", () => {
        const base = fixture();
        const cloudy = (0, battery_price_bridge_1.planBatteryPriceBridge)(base);
        const sunny = (0, battery_price_bridge_1.planBatteryPriceBridge)({ ...base, pvConfidencePct: 95 });
        strict_1.default.ok(cloudy.gridEnergyKwh >= sunny.gridEnergyKwh);
        const extraPv = { ...base, slots: base.slots.map((s, i) => i >= 12 && i < 24
                ? { ...s, pvKwh: s.pvKwh + 0.25 } : s) };
        strict_1.default.ok((0, battery_price_bridge_1.planBatteryPriceBridge)(extraPv).gridEnergyKwh < cloudy.gridEnergyKwh);
    });
    (0, node_test_1.it)("bewertet verpasste Preisfenster neu und braucht ein technisch ausführbares Ladefenster", () => {
        const input = fixture();
        const afterCheap = { ...input, nowMs: Date.parse("2026-11-09T13:00:00Z") };
        const revised = (0, battery_price_bridge_1.planBatteryPriceBridge)(afterCheap);
        strict_1.default.notEqual(revised.chargeStartIso, "2026-11-09T12:00:00.000Z");
        strict_1.default.equal((0, battery_price_bridge_1.planBatteryPriceBridge)({ ...input, maxChargePowerW: 100 }).usable, false);
    });
    (0, node_test_1.it)("bleibt für 92, 96 und 100 Viertelstunden an lokalen Zeitwechseln eindeutig", () => {
        for (const [startIso, count] of [
            ["2026-03-28T23:00:00Z", 92], // Berlin: Beginn der Sommerzeit
            ["2026-11-07T23:00:00Z", 96],
            ["2026-10-24T22:00:00Z", 100], // Berlin: Ende der Sommerzeit
        ]) {
            const input = fixture();
            const start = Date.parse(startIso);
            input.nowMs = start;
            input.slots = input.slots.slice(0, count).map((s, i) => ({ ...s,
                startIso: new Date(start + i * 900_000).toISOString(),
                endIso: new Date(start + (i + 1) * 900_000).toISOString() }));
            strict_1.default.equal(input.slots.length, count);
            const result = (0, battery_price_bridge_1.planBatteryPriceBridge)(input);
            strict_1.default.ok(result.chargeStartIso == null || Date.parse(result.chargeStartIso) >= input.nowMs);
            strict_1.default.ok(result.chargeEndIso == null || Date.parse(result.chargeEndIso) <= Date.parse(input.slots.at(-1).endIso));
        }
    });
});

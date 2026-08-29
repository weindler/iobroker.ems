import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCentralBatteryReserveTarget } from "./battery_reserve_target.js";
import type { ReserveFloorSlot } from "./unified/battery_reserve_floor";

const SLOT_MIN = 15;
const SLOT_H = SLOT_MIN / 60;
const SLOT_MS = SLOT_MIN * 60_000;

/**
 * Baut Slots ab `startMs`: `lowHours` Stunden PV≈0 (Haus konstant `houseW`), danach
 * `highHours` Stunden starke PV (`highPvW`) — Modell für „Nacht“ unterschiedlicher Länge,
 * unabhängig von festen Uhrzeiten.
 */
function buildLowPvThenRecoverySlots(opts: {
	startMs: number;
	lowHours: number;
	highHours: number;
	houseW: number;
	highPvW: number;
}): ReserveFloorSlot[] {
	const slots: ReserveFloorSlot[] = [];
	const lowSlots = Math.round((opts.lowHours * 60) / SLOT_MIN);
	const highSlots = Math.round((opts.highHours * 60) / SLOT_MIN);
	let t = opts.startMs;
	for (let i = 0; i < lowSlots; i++) {
		slots.push({
			startIso: new Date(t).toISOString(),
			endIso: new Date(t + SLOT_MS).toISOString(),
			startMs: t,
			pvKwh: 0,
			houseKwh: (opts.houseW / 1000) * SLOT_H,
			importCt: 30,
		});
		t += SLOT_MS;
	}
	for (let i = 0; i < highSlots; i++) {
		slots.push({
			startIso: new Date(t).toISOString(),
			endIso: new Date(t + SLOT_MS).toISOString(),
			startMs: t,
			pvKwh: (opts.highPvW / 1000) * SLOT_H,
			houseKwh: (opts.houseW / 1000) * SLOT_H,
			importCt: 20,
		});
		t += SLOT_MS;
	}
	return slots;
}

describe("central battery reserve target", () => {
	const nowMs = Date.parse("2026-01-15T22:00:00.000Z");

	it("shorter (summer-like) low-PV period yields a lower reserve than a longer (winter-like) one", () => {
		const summer = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 6,
			highHours: 10,
			houseW: 500,
			highPvW: 3000,
		});
		const winter = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 15,
			highHours: 10,
			houseW: 500,
			highPvW: 3000,
		});
		const common = {
			nowMs,
			pvConfidence01: 0.9,
			socPct: 80,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		};
		const rSummer = resolveCentralBatteryReserveTarget({ ...common, slots: summer });
		const rWinter = resolveCentralBatteryReserveTarget({ ...common, slots: winter });

		assert.ok(rSummer.requiredSocAtPvEndPct !== null, "summer target should be computable");
		assert.ok(rWinter.requiredSocAtPvEndPct !== null, "winter target should be computable");
		assert.ok(
			rWinter.requiredSocAtPvEndPct! > rSummer.requiredSocAtPvEndPct!,
			`winter=${rWinter.requiredSocAtPvEndPct} should exceed summer=${rSummer.requiredSocAtPvEndPct}`,
		);
		assert.ok(
			(rWinter.hoursUntilNextReliablePv ?? 0) > (rSummer.hoursUntilNextReliablePv ?? 0),
			"winter reliable PV should be further away",
		);
	});

	it("a weak/late follow-up PV forecast increases the reserve versus a strong/near one", () => {
		const goodForecast = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 8,
			highHours: 10,
			houseW: 400,
			highPvW: 4000,
		});
		const badForecast = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 8,
			highHours: 4,
			houseW: 400,
			highPvW: 600, // sehr schwache Folge-PV
		});
		const common = {
			nowMs,
			pvConfidence01: 0.9,
			socPct: 80,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		};
		const rGood = resolveCentralBatteryReserveTarget({ ...common, slots: goodForecast });
		const rBad = resolveCentralBatteryReserveTarget({ ...common, slots: badForecast });
		assert.ok(rGood.requiredSocAtPvEndPct !== null && rBad.requiredSocAtPvEndPct !== null);
		assert.ok(
			rBad.requiredSocAtPvEndPct! >= rGood.requiredSocAtPvEndPct!,
			`bad=${rBad.requiredSocAtPvEndPct} should be >= good=${rGood.requiredSocAtPvEndPct}`,
		);
	});

	it("low SOC yields a larger energyToTargetKwh / longer estimated charge time than high SOC", () => {
		const slots = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 10,
			highHours: 10,
			houseW: 500,
			highPvW: 3000,
		});
		const base = {
			nowMs,
			slots,
			pvConfidence01: 0.9,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		};
		const low = resolveCentralBatteryReserveTarget({ ...base, socPct: 10 });
		const high = resolveCentralBatteryReserveTarget({ ...base, socPct: 90 });
		assert.ok((low.energyToTargetKwh ?? 0) > (high.energyToTargetKwh ?? 0));
		assert.equal(high.energyToTargetKwh, 0);
		assert.equal(high.estimatedChargeTimeToTargetHours, null);
		assert.ok((low.estimatedChargeTimeToTargetHours ?? 0) > 0);
	});

	it("falls back to learned historical consumption when no forecast slots are available", () => {
		const r = resolveCentralBatteryReserveTarget({
			nowMs,
			slots: [],
			pvConfidence01: null,
			socPct: 60,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: 5,
			avgChargePowerW: 2000,
			contributionTargetSocPct: null,
		});
		assert.equal(r.predictedConsumptionUntilNextPvKwh, 5);
		assert.ok(r.requiredSocAtPvEndPct !== null && r.requiredSocAtPvEndPct > 0);
		assert.equal(r.nextReliablePvIso, null);
		assert.match(r.reasonDe, /gelernter Nachtverbrauch/);
	});

	it("real historical consumption acts as a floor when the forecast is more optimistic", () => {
		const slots = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 4, // Forecast sagt nur kurze PV-arme Zeit voraus
			highHours: 10,
			houseW: 200,
			highPvW: 3000,
		});
		const r = resolveCentralBatteryReserveTarget({
			nowMs,
			slots,
			pvConfidence01: 0.9,
			socPct: 80,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: 8, // real deutlich höher als der kurze Forecast-Bedarf
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		});
		assert.equal(r.predictedConsumptionUntilNextPvKwh, 8);
		assert.match(r.reasonDe, /max\(Forecast/);
	});

	it("never returns a hidden fixed fallback when both forecast and learning are missing", () => {
		const r = resolveCentralBatteryReserveTarget({
			nowMs,
			slots: [],
			pvConfidence01: null,
			socPct: 60,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: null,
			contributionTargetSocPct: null,
		});
		assert.equal(r.requiredSocAtPvEndPct, null);
		assert.equal(r.requiredReserveKwh, null);
		assert.equal(r.energyToTargetKwh, null);
		assert.equal(r.estimatedBatteryEmptyAtIso, null);
		assert.match(r.reasonDe, /Weder Forecast noch gelernter Verbrauch/);
	});

	it("the existing battery.charge contribution target is combined in (never lowers the result)", () => {
		const slots = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 6,
			highHours: 10,
			houseW: 300,
			highPvW: 3000,
		});
		const withoutContribution = resolveCentralBatteryReserveTarget({
			nowMs,
			slots,
			pvConfidence01: 0.9,
			socPct: 80,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		});
		const withHigherContribution = resolveCentralBatteryReserveTarget({
			nowMs,
			slots,
			pvConfidence01: 0.9,
			socPct: 80,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: 95,
		});
		assert.equal(withHigherContribution.requiredSocAtPvEndPct, 95);
		assert.ok(
			withHigherContribution.requiredSocAtPvEndPct! >= (withoutContribution.requiredSocAtPvEndPct ?? 0),
		);
	});

	it("estimatedBatteryEmptyAt is derived from the same consumption/time basis, not a third assumption", () => {
		const slots = buildLowPvThenRecoverySlots({
			startMs: nowMs,
			lowHours: 10,
			highHours: 10,
			houseW: 500,
			highPvW: 3000,
		});
		const r = resolveCentralBatteryReserveTarget({
			nowMs,
			slots,
			pvConfidence01: 0.9,
			socPct: 50,
			usableCapacityKwh: 20,
			predictedNightConsumptionKwh: null,
			avgChargePowerW: 3000,
			contributionTargetSocPct: null,
		});
		assert.ok(r.estimatedBatteryEmptyAtIso !== null);
		const emptyMs = Date.parse(r.estimatedBatteryEmptyAtIso!);
		assert.ok(emptyMs > nowMs, "empty-at must be in the future");
	});
});

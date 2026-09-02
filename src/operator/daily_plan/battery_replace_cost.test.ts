import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateBatteryReplaceCost } from "./battery_replace_cost.js";

const now = Date.parse("2026-01-10T18:00:00Z");

function slots(pairs: Array<[number, number]>) {
	return pairs.map(([h, ct]) => ({ startMs: now + h * 3600_000, importCtPerKwh: ct }));
}

describe("C_replace paths", () => {
	it("surplus_export wenn PV die Batterie ohnehin füllt", () => {
		const r = evaluateBatteryReplaceCost({
			nowMs: now,
			priceSlots: slots([[2, 40]]),
			headroomAboveReserveKwh: 4,
			pvRemainingTodayKwh: 12,
			plannedLaterDemandKwh: 0,
			predictedConsumptionUntilNextPvKwh: 1,
			feedInCtPerKwh: 9.3,
			gridChargeAllowed: false,
			etaPvPath: 0.92,
			etaGridPath: 0.92,
			usableCapacityKwh: 10,
			socPct: 80,
			maxSocPct: 100,
		});
		assert.equal(r.usable, true);
		assert.equal(r.path, "surplus_export");
		assert.ok(r.valueCtPerKwh != null && r.valueCtPerKwh > 9);
	});

	it("later_avoided_import wenn Extra-kWh später teuren Bezug verhindert", () => {
		const r = evaluateBatteryReplaceCost({
			nowMs: now,
			priceSlots: slots([
				[2, 20],
				[6, 42],
			]),
			headroomAboveReserveKwh: 0.3,
			pvRemainingTodayKwh: 0,
			plannedLaterDemandKwh: 2,
			predictedConsumptionUntilNextPvKwh: 3,
			feedInCtPerKwh: 9.3,
			gridChargeAllowed: false,
			etaPvPath: 0.92,
			etaGridPath: 0.92,
			usableCapacityKwh: 10,
			socPct: 55,
			maxSocPct: 100,
		});
		assert.equal(r.usable, true);
		assert.equal(r.path, "later_avoided_import");
		assert.equal(r.valueCtPerKwh, 42);
	});

	it("grid_charge über günstiges Fenster / η", () => {
		const r = evaluateBatteryReplaceCost({
			nowMs: now,
			priceSlots: slots([
				[2, 18],
				[8, 36],
			]),
			headroomAboveReserveKwh: 4,
			pvRemainingTodayKwh: 0.2,
			plannedLaterDemandKwh: 0,
			predictedConsumptionUntilNextPvKwh: 0.4,
			feedInCtPerKwh: 9.3,
			gridChargeAllowed: true,
			etaPvPath: 0.92,
			etaGridPath: 0.92,
			usableCapacityKwh: 10,
			socPct: 70,
			maxSocPct: 100,
		});
		assert.equal(r.usable, true);
		assert.equal(r.path, "grid_charge");
		assert.ok(r.valueCtPerKwh != null);
		assert.ok(Math.abs(r.valueCtPerKwh! - 18 / 0.92) < 0.05);
	});

	it("nicht usable ohne dominanten Pfad", () => {
		const r = evaluateBatteryReplaceCost({
			nowMs: now,
			priceSlots: [],
			headroomAboveReserveKwh: null,
			pvRemainingTodayKwh: null,
			plannedLaterDemandKwh: null,
			predictedConsumptionUntilNextPvKwh: null,
			feedInCtPerKwh: null,
			gridChargeAllowed: false,
			etaPvPath: 0.92,
			etaGridPath: 0.92,
			usableCapacityKwh: null,
			socPct: null,
			maxSocPct: null,
		});
		assert.equal(r.usable, false);
		assert.equal(r.path, null);
		assert.equal(r.valueCtPerKwh, null);
	});
});

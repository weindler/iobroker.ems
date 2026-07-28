import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pvSurplusCoversChargeNeed, todayPvSurplusKwh } from "./battery_pv_cover";

describe("battery PV cover", () => {
	it("computes today surplus as max(0, pv − load)", () => {
		assert.equal(todayPvSurplusKwh(20, 12), 8);
		assert.equal(todayPvSurplusKwh(10, 15), 0);
		assert.equal(todayPvSurplusKwh(null, 12), null);
		assert.equal(todayPvSurplusKwh(20, null), null);
	});

	it("covers charge need when surplus ≥ required and no top-off", () => {
		assert.equal(
			pvSurplusCoversChargeNeed({
				requiredChargeEnergyKwh: 4,
				todayPvSurplusKwh: 8,
				topOffRequested: false,
				learnedTopoffDue: false,
			}),
			true,
		);
	});

	it("does not cover when surplus below need", () => {
		assert.equal(
			pvSurplusCoversChargeNeed({
				requiredChargeEnergyKwh: 4,
				todayPvSurplusKwh: 3,
				topOffRequested: false,
				learnedTopoffDue: false,
			}),
			false,
		);
	});

	it("keeps EMS slots when top-off is requested or learned due", () => {
		assert.equal(
			pvSurplusCoversChargeNeed({
				requiredChargeEnergyKwh: 1,
				todayPvSurplusKwh: 20,
				topOffRequested: true,
				learnedTopoffDue: false,
			}),
			false,
		);
		assert.equal(
			pvSurplusCoversChargeNeed({
				requiredChargeEnergyKwh: 1,
				todayPvSurplusKwh: 20,
				topOffRequested: false,
				learnedTopoffDue: true,
			}),
			false,
		);
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planSafeRestore } from "./restore.js";
import { emptyOwnership } from "./ownership.js";

describe("planSafeRestore", () => {
	it("not required without EMS ownership", () => {
		const plan = planSafeRestore({ ownership: emptyOwnership(), gridBalanceWasActive: false });
		assert.equal(plan.required, false);
		assert.equal(plan.stopCharge, false);
		assert.equal(plan.setSelfConsumption, false);
		assert.equal(plan.restoreGridBalance, false);
		assert.equal(plan.reason, "no_ownership");
	});

	it("not required when EMS is active but never wrote manual mode itself", () => {
		const ownership = { ...emptyOwnership(), active: true, manualModeWritten: false };
		const plan = planSafeRestore({ ownership, gridBalanceWasActive: false });
		assert.equal(plan.required, false);
		assert.equal(plan.reason, "no_ownership");
	});

	it("requires stop_charge + self_consumption once EMS wrote manual mode", () => {
		const ownership = { ...emptyOwnership(), active: true, manualModeWritten: true };
		const plan = planSafeRestore({ ownership, gridBalanceWasActive: false });
		assert.equal(plan.required, true);
		assert.equal(plan.stopCharge, true);
		assert.equal(plan.setSelfConsumption, true);
		assert.equal(plan.restoreGridBalance, false);
		assert.equal(plan.reason, "ems_ownership");
	});

	it("restores grid balance only if it was paused by the FSM", () => {
		const ownership = { ...emptyOwnership(), active: true, manualModeWritten: true };
		const plan = planSafeRestore({ ownership, gridBalanceWasActive: true });
		assert.equal(plan.restoreGridBalance, true);
	});
});

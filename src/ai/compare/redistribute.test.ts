import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSlotWeight, redistributeAddonAcrossSlots, waterFillProportional } from "./redistribute.js";

describe("computeSlotWeight", () => {
	it("multiplier=1 (neutral) → weight equals ownW regardless of capacity headroom", () => {
		assert.equal(computeSlotWeight(300, 300, 1), 300);
		assert.equal(computeSlotWeight(300, 900, 1), 300);
		assert.equal(computeSlotWeight(0, 900, 1), 0);
	});

	it("multiplier=0 (avoid) → weight is always 0", () => {
		assert.equal(computeSlotWeight(300, 900, 0), 0);
		assert.equal(computeSlotWeight(0, 900, 0), 0);
	});

	it("multiplier>1 grants proportional access to unused headroom", () => {
		// ownW=0, capacity=500 → extra=500, weight = 0*2 + 500*(2-1) = 500.
		assert.equal(computeSlotWeight(0, 500, 2), 500);
		// ownW=200, capacity=500 → extra=300, weight = 200*2 + 300*1 = 700.
		assert.equal(computeSlotWeight(200, 500, 2), 700);
	});

	it("clamps multiplier to [0,3]", () => {
		assert.equal(computeSlotWeight(100, 100, 10), computeSlotWeight(100, 100, 3));
		assert.equal(computeSlotWeight(100, 100, -5), computeSlotWeight(100, 100, 0));
	});
});

describe("waterFillProportional", () => {
	it("distributes proportionally to weights when nothing is capacity-constrained", () => {
		const result = waterFillProportional([1, 3], [1000, 1000], 400);
		assert.equal(result[0], 100);
		assert.equal(result[1], 300);
	});

	it("clamps a slot at its capacity and redistributes the remainder to others", () => {
		// slot 0 wants (weight 3 of total 4) * 400 = 300 but only has 100 capacity.
		const result = waterFillProportional([3, 1], [100, 1000], 400);
		assert.equal(result[0], 100);
		assert.equal(result[1], 300);
	});

	it("never exceeds total available capacity", () => {
		const result = waterFillProportional([1, 1], [50, 50], 1000);
		assert.equal(result[0], 50);
		assert.equal(result[1], 50);
	});

	it("zero weight slots with zero total input get nothing, no NaN/negative values", () => {
		const result = waterFillProportional([0, 0], [100, 100], 0);
		assert.deepEqual(result, [0, 0]);
	});

	it("skips zero-weight (avoided) slots even if they have capacity", () => {
		const result = waterFillProportional([0, 1], [100, 100], 60);
		assert.equal(result[0], 0);
		assert.equal(result[1], 60);
	});

	it("still conserves total energy via capacity fallback when every slot has zero weight", () => {
		// No positive weight anywhere (e.g. AI avoided everything without a clear alternative) —
		// energy conservation must still hold, distributed by leftover capacity.
		const result = waterFillProportional([0, 0], [300, 100], 400);
		assert.equal(result[0] + result[1], 400);
		assert.ok(result[0] <= 300);
		assert.ok(result[1] <= 100);
	});
});

describe("redistributeAddonAcrossSlots", () => {
	it("reproduces Plan A exactly when all multipliers are neutral (1)", () => {
		const slots = [
			{ ownW: 500, capacityW: 500 },
			{ ownW: 0, capacityW: 800 },
			{ ownW: 200, capacityW: 1000 },
		];
		const result = redistributeAddonAcrossSlots(slots, [1, 1, 1]);
		assert.deepEqual(result, [500, 0, 200]);
	});

	it("shifts energy away from an avoided slot into slots with capacity headroom", () => {
		const slots = [
			{ ownW: 400, capacityW: 400 },
			{ ownW: 0, capacityW: 600 },
		];
		// avoid slot 0 entirely → its 400W must move to slot 1 (which has headroom for it).
		const result = redistributeAddonAcrossSlots(slots, [0, 2]);
		assert.equal(result[0], 0);
		assert.equal(result[1], 400);
	});

	it("conserves total energy across all slots regardless of weighting", () => {
		const slots = [
			{ ownW: 300, capacityW: 900 },
			{ ownW: 100, capacityW: 900 },
			{ ownW: 0, capacityW: 900 },
		];
		const totalBefore = slots.reduce((s, x) => s + x.ownW, 0);
		const result = redistributeAddonAcrossSlots(slots, [3, 1, 0.2]);
		const totalAfter = result.reduce((s, x) => s + x, 0);
		assert.ok(Math.abs(totalAfter - totalBefore) < 1e-6);
	});

	it("with minPowerW coalesces micro crumbs into runnable stages or drops them", () => {
		const slots = [
			{ ownW: 8, capacityW: 2000 },
			{ ownW: 8, capacityW: 2000 },
			{ ownW: 8, capacityW: 2000 },
			{ ownW: 1700, capacityW: 2000 },
		];
		const result = redistributeAddonAcrossSlots(slots, [1, 1, 1, 1], 1700);
		assert.ok(result.every((w) => w === 0 || w >= 1700));
		assert.equal(result[3], 1700);
	});

	it("never assigns more than a slot's own capacity", () => {
		const slots = [
			{ ownW: 100, capacityW: 150 },
			{ ownW: 300, capacityW: 900 },
		];
		const result = redistributeAddonAcrossSlots(slots, [3, 1]);
		assert.ok(result[0] <= 150);
		assert.ok(result[1] <= 900);
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGridBalancePolicyLoadAdjustment } from "./grid_balance_policy.js";

describe("grid balance policy load adjustment (Phase 1)", () => {
	it("leaves load unchanged when no consumer is excluded", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: true, commandedPowerW: 1700 }],
		});
		assert.equal(r.policyAdjustedConsumptionW, 2000);
		assert.equal(r.excludedLoadW, 0);
		assert.deepEqual(r.excludedConsumerIds, []);
		assert.equal(r.reasonDe, "");
	});

	it("subtracts commanded power of a policy-disallowed consumer (Heizstab-Fall)", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
		});
		assert.equal(r.policyAdjustedConsumptionW, 300);
		assert.equal(r.excludedLoadW, 1700);
		assert.deepEqual(r.excludedConsumerIds, ["immersion_heater"]);
		assert.match(r.reasonDe, /immersion_heater \(1700 W\)/);
		assert.match(r.reasonDe, /Policy: Batterie für diesen Verbraucher nicht erlaubt/);
	});

	it("clamps to zero instead of going negative", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 500,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
		});
		assert.equal(r.policyAdjustedConsumptionW, 0);
		assert.equal(r.excludedLoadW, 1700);
	});

	it("ignores disallowed consumer with zero/null commanded power", () => {
		const r1 = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 0 }],
		});
		assert.equal(r1.policyAdjustedConsumptionW, 2000);
		assert.equal(r1.excludedLoadW, 0);

		const r2 = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: null }],
		});
		assert.equal(r2.policyAdjustedConsumptionW, 2000);
		assert.equal(r2.excludedLoadW, 0);
	});

	it("sums multiple excluded consumers (Erweiterbarkeit für spätere Add-ons)", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 5000,
			excludedConsumers: [
				{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 },
				{ id: "air_conditioning.unit_1", allowedOnBattery: false, commandedPowerW: 800 },
				{ id: "wallbox", allowedOnBattery: true, commandedPowerW: 3000 },
			],
		});
		assert.equal(r.excludedLoadW, 2500);
		assert.equal(r.policyAdjustedConsumptionW, 2500);
		assert.deepEqual(r.excludedConsumerIds, ["immersion_heater", "air_conditioning.unit_1"]);
	});

	it("treats non-finite raw consumption as zero", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: Number.NaN,
			excludedConsumers: [],
		});
		assert.equal(r.policyAdjustedConsumptionW, 0);
		assert.equal(r.excludedLoadW, 0);
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parseExplicitBatteryPermission,
	resolveGridBalancePolicyLoadAdjustment,
} from "./grid_balance_policy.js";

describe("grid balance uses the physical whole-house load", () => {
	it("preserves explicit permission parsing for compatibility", () => {
		assert.equal(parseExplicitBatteryPermission(true), true);
		assert.equal(parseExplicitBatteryPermission(false), false);
		for (const raw of [null, undefined, 0, 1, "true", "false", ""]) {
			assert.equal(parseExplicitBatteryPermission(raw), null);
		}
	});

	it("does not subtract a running heater when battery support is denied", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
		});
		assert.equal(r.policyAdjustedConsumptionW, 2000);
		assert.equal(r.excludedLoadW, 0);
		assert.deepEqual(r.excludedConsumerIds, []);
		assert.equal(r.reasonDe, "");
	});

	it("does not subtract a running heater when permission is temporarily unknown", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 2000,
			excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: null, commandedPowerW: 1700 }],
		});
		assert.equal(r.policyAdjustedConsumptionW, 2000);
		assert.equal(r.excludedLoadW, 0);
	});

	it("keeps all simultaneous household consumers in the control load", () => {
		const r = resolveGridBalancePolicyLoadAdjustment({
			rawConsumptionW: 5000,
			excludedConsumers: [
				{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 },
				{ id: "air_conditioning.unit_1", allowedOnBattery: false, commandedPowerW: 800 },
				{ id: "wallbox", allowedOnBattery: true, commandedPowerW: 3000 },
			],
		});
		assert.equal(r.policyAdjustedConsumptionW, 5000);
		assert.equal(r.excludedLoadW, 0);
	});

	it("clamps invalid or negative raw consumption to zero", () => {
		for (const rawConsumptionW of [Number.NaN, -500]) {
			const r = resolveGridBalancePolicyLoadAdjustment({
				rawConsumptionW,
				excludedConsumers: [],
			});
			assert.equal(r.policyAdjustedConsumptionW, 0);
			assert.equal(r.excludedLoadW, 0);
		}
	});
});

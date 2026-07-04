import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { plannerModePolicyFromGlobalMode } from "./mode_policy.js";

describe("planner mode policy", () => {
	it("off disables optimization", () => {
		const p = plannerModePolicyFromGlobalMode("off");
		assert.equal(p.allowOptimization, false);
		assert.equal(p.allowThermalAuto, false);
	});

	it("comfort supports deficit", () => {
		const p = plannerModePolicyFromGlobalMode("comfort");
		assert.equal(p.supportBatteryOnDeficit, true);
		assert.equal(p.batteryMinSocForDeficitPct, 15);
	});

	it("forced supports deficit with lower reserve", () => {
		const p = plannerModePolicyFromGlobalMode("forced");
		assert.equal(p.supportBatteryOnDeficit, true);
		assert.equal(p.chargeTargetSocPct, 98);
	});

	it("invalid falls back to balanced", () => {
		const p = plannerModePolicyFromGlobalMode("invalid");
		assert.equal(p.mode, "balanced");
	});
});

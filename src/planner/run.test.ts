import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config.js";
import { plannerModePolicyFromGlobalMode } from "./mode_policy.js";
import { resetPlannerRevisionForTest, runPlanner } from "./run.js";
import type { PlannerInputs } from "./inputs.js";

const NOW = new Date("2026-07-04T08:00:00Z");
const BALANCED = plannerModePolicyFromGlobalMode("balanced");

function baseInputs(overrides: Partial<PlannerInputs> = {}): PlannerInputs {
	return {
		now: NOW,
		globalMode: "balanced",
		modePolicy: BALANCED,
		pvPowerW: 6000,
		houseLoadW: 1500,
		socPct: 70,
		bufferTempC: 52,
		thermalMode: "auto",
		thermalGovernanceEnabled: true,
		batteryGovernanceEnabled: true,
		evccBatteryMode: "normal",
		evccBatteryDischargeControl: false,
		userIntentBatteryHold: false,
		userIntentBatteryCharge: false,
		immersionConfig: immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 2000,
			ih_planning_max_temp_c: 60,
		}),
		pvTodayKwh: 12,
		pvTomorrowKwh: 12,
		pvBiasStatus: "ready",
		forecastModeEnabled: false,
		aiOptimizationAllowed: false,
		...overrides,
	};
}

describe("planner run", () => {
	it("prioritizes heater then battery on surplus", () => {
		resetPlannerRevisionForTest();
		const intent = runPlanner(baseInputs());
		assert.equal(intent.surplus_w, 4500);
		assert.equal(intent.thermal.commanded_stage, 1);
		assert.equal(intent.battery.action, "charge");
		assert.ok(intent.battery.max_charge_w >= 2000);
	});

	it("skips battery on evcc hold", () => {
		resetPlannerRevisionForTest();
		const intent = runPlanner(
			baseInputs({
				evccBatteryMode: "hold",
				evccBatteryDischargeControl: true,
			}),
		);
		assert.equal(intent.constraints.battery_hold_active, true);
		assert.equal(intent.battery.action, "hold");
		assert.equal(intent.thermal.commanded_stage, 1);
	});

	it("comfort uses battery on cloud deficit", () => {
		resetPlannerRevisionForTest();
		const intent = runPlanner(
			baseInputs({
				modePolicy: plannerModePolicyFromGlobalMode("comfort"),
				globalMode: "comfort",
				pvPowerW: 800,
				houseLoadW: 2500,
				socPct: 60,
			}),
		);
		assert.equal(intent.deficit_w, 1700);
		assert.equal(intent.battery.action, "self_consumption");
	});

	it("off mode blocks planner optimization", () => {
		resetPlannerRevisionForTest();
		const intent = runPlanner(
			baseInputs({
				modePolicy: plannerModePolicyFromGlobalMode("off"),
				globalMode: "off",
			}),
		);
		assert.equal(intent.thermal.commanded_stage, 0);
		assert.equal(intent.battery.action, "none");
	});
});

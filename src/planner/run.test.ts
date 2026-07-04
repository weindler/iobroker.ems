import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config.js";
import { resetPlannerRevisionForTest, runPlanner } from "./run.js";
import type { PlannerInputs } from "./inputs.js";

const NOW = new Date("2026-07-04T08:00:00Z");

function baseInputs(overrides: Partial<PlannerInputs> = {}): PlannerInputs {
	return {
		now: NOW,
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
		immersionConfig: immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 2000,
			ih_planning_max_temp_c: 60,
		}),
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
		assert.equal(intent.constraints.evcc_battery_hold, true);
		assert.equal(intent.battery.action, "none");
		assert.equal(intent.thermal.commanded_stage, 1);
	});
});

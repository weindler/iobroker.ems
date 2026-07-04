import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config.js";
import { computePvSurplusW } from "./surplus.js";
import { planThermal } from "./thermal.js";
import { buildPlannerConstraints, planBattery } from "./battery.js";

const CFG = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_stage_1_nominal_power_w: 2000,
	ih_stage_2_nominal_power_w: 3000,
	ih_stage_count: 2,
	ih_planning_max_temp_c: 60,
});

describe("planner surplus", () => {
	it("computes positive surplus", () => {
		assert.equal(computePvSurplusW(5000, 2000), 3000);
	});
	it("never negative", () => {
		assert.equal(computePvSurplusW(1000, 2000), 0);
	});
});

describe("planner thermal", () => {
	it("picks highest affordable stage", () => {
		const r = planThermal({
			surplusW: 2500,
			bufferTempC: 50,
			thermalMode: "auto",
			governanceEnabled: true,
			config: CFG,
		});
		assert.equal(r.commanded_stage, 1);
		assert.equal(r.commanded_power_w, 2000);
	});

	it("respects max temp", () => {
		const r = planThermal({
			surplusW: 5000,
			bufferTempC: 60,
			thermalMode: "auto",
			governanceEnabled: true,
			config: CFG,
		});
		assert.equal(r.commanded_stage, 0);
	});
});

describe("planner battery", () => {
	it("blocks on evcc hold", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "hold",
			evccBatteryDischargeControl: true,
			userIntentBatteryHold: false,
		});
		const r = planBattery({
			surplusW: 3000,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 2000,
		});
		assert.equal(r.action, "none");
	});

	it("charges from remaining surplus", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
		});
		const r = planBattery({
			surplusW: 3000,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 2000,
		});
		assert.equal(r.action, "charge");
		assert.equal(r.max_charge_w, 1000);
	});
});

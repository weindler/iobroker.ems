import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config.js";
import { plannerModePolicyFromGlobalMode } from "../mode_policy.js";
import { computePvSurplusW } from "./surplus.js";
import { planThermal } from "./thermal.js";
import { buildPlannerConstraints, planBattery } from "./battery.js";

const BALANCED = plannerModePolicyFromGlobalMode("balanced");
const COMFORT = plannerModePolicyFromGlobalMode("comfort");

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
	it("single on/off turns on when surplus covers nominal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal({
			surplusW: 1800,
			bufferTempC: 50,
			thermalMode: "auto",
			governanceEnabled: true,
			config: cfg,
			modePolicy: BALANCED,
		});
		assert.equal(r.commanded_stage, 1);
		assert.match(r.reason_de, /Ein \(1700 W\)/);
	});

	it("single on/off stays off below nominal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal({
			surplusW: 1270,
			bufferTempC: 50,
			thermalMode: "auto",
			governanceEnabled: true,
			config: cfg,
			modePolicy: BALANCED,
		});
		assert.equal(r.commanded_stage, 0);
		assert.match(r.reason_de, /Ein\/Aus/);
	});

	it("off global mode blocks thermal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal({
			surplusW: 5000,
			bufferTempC: 50,
			thermalMode: "auto",
			governanceEnabled: true,
			config: cfg,
			modePolicy: plannerModePolicyFromGlobalMode("off"),
		});
		assert.equal(r.commanded_stage, 0);
	});

	it("multi-stage picks highest affordable stage", () => {
		const r = planThermal({
			surplusW: 2500,
			bufferTempC: 50,
			thermalMode: "auto",
			governanceEnabled: true,
			config: CFG,
			modePolicy: BALANCED,
		});
		assert.equal(r.commanded_stage, 1);
		assert.equal(r.commanded_power_w, 2000);
	});

	it("respects max temp", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
			ih_planning_max_temp_c: 60,
		});
		const r = planThermal({
			surplusW: 5000,
			bufferTempC: 60,
			thermalMode: "auto",
			governanceEnabled: true,
			config: cfg,
			modePolicy: BALANCED,
		});
		assert.equal(r.commanded_stage, 0);
	});
});

describe("planner battery", () => {
	it("returns hold on evcc hold", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "hold",
			evccBatteryDischargeControl: true,
			userIntentBatteryHold: false,
		});
		const r = planBattery({
			surplusW: 3000,
			deficitW: 0,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 2000,
			modePolicy: BALANCED,
		});
		assert.equal(r.action, "hold");
	});

	it("charges from remaining surplus", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
		});
		const r = planBattery({
			surplusW: 3000,
			deficitW: 0,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 2000,
			modePolicy: BALANCED,
		});
		assert.equal(r.action, "charge");
		assert.equal(r.max_charge_w, 1000);
	});

	it("comfort supports deficit self consumption", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
		});
		const r = planBattery({
			surplusW: 0,
			deficitW: 1200,
			socPct: 55,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 0,
			modePolicy: COMFORT,
		});
		assert.equal(r.action, "self_consumption");
	});

	it("forced respects user_intent hold for cheap price", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: true,
		});
		const r = planBattery({
			surplusW: 0,
			deficitW: 1500,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			thermalAllocatedW: 0,
			modePolicy: plannerModePolicyFromGlobalMode("forced"),
		});
		assert.equal(r.action, "hold");
	});
});

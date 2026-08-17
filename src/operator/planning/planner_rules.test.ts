import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config.js";
import { plannerModePolicyFromGlobalMode } from "../../planner/mode_policy.js";
import { computePvSurplusW } from "./surplus.js";
import { planThermal, type ThermalPlanInput } from "./thermal.js";
import { buildPlannerConstraints, planBattery } from "./battery.js";

const BALANCED = plannerModePolicyFromGlobalMode("balanced");
const COMFORT = plannerModePolicyFromGlobalMode("comfort");

const CFG = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_stage_1_nominal_power_w: 2000,
	ih_stage_2_nominal_power_w: 3000,
	ih_stage_count: 2,
	ih_planning_max_temp_c: 60,
	ih_planning_min_temp_c: 48,
});

function thermalInput(overrides: Partial<ThermalPlanInput> = {}): ThermalPlanInput {
	return {
		surplusW: 1800,
		bufferTempC: 50,
		thermalMode: "auto",
		governanceEnabled: true,
		config: CFG,
		modePolicy: BALANCED,
		pvTodayKwh: 15,
		pvTomorrowKwh: 15,
		pvBiasStatus: "ready",
		forecastModeEnabled: false,
		aiOptimizationAllowed: false,
		...overrides,
	};
}

describe("planner thermal", () => {
	it("single on/off turns on when surplus covers nominal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal(
			thermalInput({
				surplusW: 1800,
				config: cfg,
			}),
		);
		assert.equal(r.commanded_stage, 1);
		assert.match(r.reason_de, /Ein \(1700 W\)/);
	});

	it("single on/off stays off below nominal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal(
			thermalInput({
				surplusW: 1270,
				config: cfg,
			}),
		);
		assert.equal(r.commanded_stage, 0);
		assert.match(r.reason_de, /Ein\/Aus/);
	});

	it("off global mode blocks thermal", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
		});
		const r = planThermal(
			thermalInput({
				surplusW: 5000,
				config: cfg,
				modePolicy: plannerModePolicyFromGlobalMode("off"),
			}),
		);
		assert.equal(r.commanded_stage, 0);
	});

	it("multi-stage picks highest affordable stage", () => {
		const r = planThermal(
			thermalInput({
				surplusW: 2500,
			}),
		);
		assert.equal(r.commanded_stage, 1);
		assert.equal(r.commanded_power_w, 2000);
	});

	it("respects max temp", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
			ih_planning_max_temp_c: 60,
		});
		const r = planThermal(
			thermalInput({
				surplusW: 5000,
				bufferTempC: 60,
				config: cfg,
			}),
		);
		assert.equal(r.commanded_stage, 0);
	});

	it("respects forecast daily target below hard max", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_stage_1_nominal_power_w: 1700,
			ih_planning_min_temp_c: 48,
			ih_planning_max_temp_c: 63,
			ih_forecast_mode_enabled: true,
		});
		const r = planThermal(
			thermalInput({
				surplusW: 5000,
				bufferTempC: 55,
				config: cfg,
				forecastModeEnabled: true,
				pvTodayKwh: 20,
				pvTomorrowKwh: 18,
			}),
		);
		/** Soft-Ziel zwischen Ist (55) und Max (63), moderater Anteil → 58.2 °C (< Max). */
		assert.equal(r.target_temp_c, 58.2);
		assert.ok(r.target_temp_c < 63);
		assert.equal(r.commanded_stage, 1);
		assert.match(r.reason_de, /Ziel 58\.2/);
	});
});

describe("planner surplus", () => {
	it("computes positive surplus", () => {
		assert.equal(computePvSurplusW(5000, 2000), 3000);
	});
	it("never negative", () => {
		assert.equal(computePvSurplusW(1000, 2000), 0);
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
			consumerAllocatedW: 2000,
			modePolicy: BALANCED,
		});
		assert.equal(r.action, "hold");
	});

	it("stays passive on surplus (Sonnen Mode 2)", () => {
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
			consumerAllocatedW: 2000,
			modePolicy: BALANCED,
		});
		assert.equal(r.action, "none");
		assert.match(r.reason_de, /Mode 2 passiv/);
	});

	it("stays passive on deficit (comfort)", () => {
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
			consumerAllocatedW: 0,
			modePolicy: COMFORT,
		});
		assert.equal(r.action, "none");
		assert.match(r.reason_de, /Mode 2 passiv/);
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
			consumerAllocatedW: 0,
			modePolicy: plannerModePolicyFromGlobalMode("forced"),
		});
		assert.equal(r.action, "hold");
	});

	it("activates hold on wallboxChargeHold (boost/external)", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
			wallboxChargeHold: true,
			wallboxChargeHoldReasonDe: "EVCC Boost aktiv",
		});
		assert.equal(constraints.battery_hold_active, true);
		assert.match(constraints.reason_de, /Boost/);
	});

	it("does not hold from wallboxChargeHold false", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "normal",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
			wallboxChargeHold: false,
		});
		assert.equal(constraints.battery_hold_active, false);
	});

	it("does not mint battery_hold_active from discharge control alone", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "unknown",
			evccBatteryDischargeControl: true,
			userIntentBatteryHold: false,
		});
		assert.equal(constraints.battery_hold_active, false);
		assert.equal(constraints.evcc_battery_hold, false);
		assert.equal(constraints.evcc_battery_discharge_control, true);
		const r = planBattery({
			surplusW: 3000,
			deficitW: 0,
			socPct: 80,
			governanceEnabled: true,
			constraints,
			consumerAllocatedW: 2000,
			modePolicy: BALANCED,
		});
		assert.equal(r.action, "none");
	});

	it("keeps hold on EVCC battery_mode holdcharge", () => {
		const constraints = buildPlannerConstraints({
			evccBatteryMode: "holdcharge",
			evccBatteryDischargeControl: false,
			userIntentBatteryHold: false,
		});
		assert.equal(constraints.battery_hold_active, true);
		assert.equal(constraints.evcc_battery_hold, true);
	});
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("../../addons/immersion_heater/device_config.js");
const mode_policy_js_1 = require("../../planner/mode_policy.js");
const surplus_js_1 = require("./surplus.js");
const thermal_js_1 = require("./thermal.js");
const battery_js_1 = require("./battery.js");
const BALANCED = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced");
const COMFORT = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("comfort");
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_stage_1_nominal_power_w: 2000,
    ih_stage_2_nominal_power_w: 3000,
    ih_stage_count: 2,
    ih_planning_max_temp_c: 60,
    ih_planning_min_temp_c: 48,
});
function thermalInput(overrides = {}) {
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
(0, node_test_1.describe)("planner thermal", () => {
    (0, node_test_1.it)("single on/off turns on when surplus covers nominal", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
        });
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 1800,
            config: cfg,
        }));
        strict_1.default.equal(r.commanded_stage, 1);
        strict_1.default.match(r.reason_de, /Ein \(1700 W\)/);
    });
    (0, node_test_1.it)("single on/off stays off below nominal", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
        });
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 1270,
            config: cfg,
        }));
        strict_1.default.equal(r.commanded_stage, 0);
        strict_1.default.match(r.reason_de, /Ein\/Aus/);
    });
    (0, node_test_1.it)("off global mode blocks thermal", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
        });
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 5000,
            config: cfg,
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("off"),
        }));
        strict_1.default.equal(r.commanded_stage, 0);
    });
    (0, node_test_1.it)("multi-stage picks highest affordable stage", () => {
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 2500,
        }));
        strict_1.default.equal(r.commanded_stage, 1);
        strict_1.default.equal(r.commanded_power_w, 2000);
    });
    (0, node_test_1.it)("respects max temp", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
            ih_planning_max_temp_c: 60,
        });
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 5000,
            bufferTempC: 60,
            config: cfg,
        }));
        strict_1.default.equal(r.commanded_stage, 0);
    });
    (0, node_test_1.it)("respects forecast daily target below hard max", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
            ih_planning_min_temp_c: 48,
            ih_planning_max_temp_c: 63,
            ih_forecast_mode_enabled: true,
        });
        const r = (0, thermal_js_1.planThermal)(thermalInput({
            surplusW: 5000,
            bufferTempC: 55,
            config: cfg,
            forecastModeEnabled: true,
            pvTodayKwh: 20,
            pvTomorrowKwh: 18,
        }));
        /** Soft-Ziel zwischen Ist (55) und Max (63), moderater Anteil → 58.2 °C (< Max). */
        strict_1.default.equal(r.target_temp_c, 58.2);
        strict_1.default.ok(r.target_temp_c < 63);
        strict_1.default.equal(r.commanded_stage, 1);
        strict_1.default.match(r.reason_de, /Ziel 58\.2/);
    });
});
(0, node_test_1.describe)("planner surplus", () => {
    (0, node_test_1.it)("computes positive surplus", () => {
        strict_1.default.equal((0, surplus_js_1.computePvSurplusW)(5000, 2000), 3000);
    });
    (0, node_test_1.it)("never negative", () => {
        strict_1.default.equal((0, surplus_js_1.computePvSurplusW)(1000, 2000), 0);
    });
});
(0, node_test_1.describe)("planner battery", () => {
    (0, node_test_1.it)("returns hold on evcc hold", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "hold",
            evccBatteryDischargeControl: true,
            userIntentBatteryHold: false,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 3000,
            deficitW: 0,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            consumerAllocatedW: 2000,
            modePolicy: BALANCED,
        });
        strict_1.default.equal(r.action, "hold");
    });
    (0, node_test_1.it)("stays passive on surplus (Sonnen Mode 2)", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 3000,
            deficitW: 0,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            consumerAllocatedW: 2000,
            modePolicy: BALANCED,
        });
        strict_1.default.equal(r.action, "none");
        strict_1.default.match(r.reason_de, /Mode 2 passiv/);
    });
    (0, node_test_1.it)("stays passive on deficit (comfort)", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 0,
            deficitW: 1200,
            socPct: 55,
            governanceEnabled: true,
            constraints,
            consumerAllocatedW: 0,
            modePolicy: COMFORT,
        });
        strict_1.default.equal(r.action, "none");
        strict_1.default.match(r.reason_de, /Mode 2 passiv/);
    });
    (0, node_test_1.it)("forced respects user_intent hold for cheap price", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: true,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 0,
            deficitW: 1500,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            consumerAllocatedW: 0,
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("forced"),
        });
        strict_1.default.equal(r.action, "hold");
    });
    (0, node_test_1.it)("activates hold on wallboxChargeHold (boost/external)", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
            wallboxChargeHold: true,
            wallboxChargeHoldReasonDe: "EVCC Boost aktiv",
        });
        strict_1.default.equal(constraints.battery_hold_active, true);
        strict_1.default.match(constraints.reason_de, /Boost/);
    });
    (0, node_test_1.it)("does not hold from wallboxChargeHold false", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
            wallboxChargeHold: false,
        });
        strict_1.default.equal(constraints.battery_hold_active, false);
    });
    (0, node_test_1.it)("does not mint battery_hold_active from discharge control alone", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "unknown",
            evccBatteryDischargeControl: true,
            userIntentBatteryHold: false,
        });
        strict_1.default.equal(constraints.battery_hold_active, false);
        strict_1.default.equal(constraints.evcc_battery_hold, false);
        strict_1.default.equal(constraints.evcc_battery_discharge_control, true);
        const r = (0, battery_js_1.planBattery)({
            surplusW: 3000,
            deficitW: 0,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            consumerAllocatedW: 2000,
            modePolicy: BALANCED,
        });
        strict_1.default.equal(r.action, "none");
    });
    (0, node_test_1.it)("keeps hold on EVCC battery_mode holdcharge", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "holdcharge",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
        });
        strict_1.default.equal(constraints.battery_hold_active, true);
        strict_1.default.equal(constraints.evcc_battery_hold, true);
    });
});

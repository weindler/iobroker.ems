"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("../../addons/immersion_heater/device_config.js");
const surplus_js_1 = require("./surplus.js");
const thermal_js_1 = require("./thermal.js");
const battery_js_1 = require("./battery.js");
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_stage_1_nominal_power_w: 2000,
    ih_stage_2_nominal_power_w: 3000,
    ih_stage_count: 2,
    ih_planning_max_temp_c: 60,
});
(0, node_test_1.describe)("planner surplus", () => {
    (0, node_test_1.it)("computes positive surplus", () => {
        strict_1.default.equal((0, surplus_js_1.computePvSurplusW)(5000, 2000), 3000);
    });
    (0, node_test_1.it)("never negative", () => {
        strict_1.default.equal((0, surplus_js_1.computePvSurplusW)(1000, 2000), 0);
    });
});
(0, node_test_1.describe)("planner thermal", () => {
    (0, node_test_1.it)("single on/off turns on when surplus covers nominal", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
        });
        const r = (0, thermal_js_1.planThermal)({
            surplusW: 1800,
            bufferTempC: 50,
            thermalMode: "auto",
            governanceEnabled: true,
            config: cfg,
        });
        strict_1.default.equal(r.commanded_stage, 1);
        strict_1.default.match(r.reason_de, /Ein \(1700 W\)/);
    });
    (0, node_test_1.it)("single on/off stays off below nominal", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
        });
        const r = (0, thermal_js_1.planThermal)({
            surplusW: 1270,
            bufferTempC: 50,
            thermalMode: "auto",
            governanceEnabled: true,
            config: cfg,
        });
        strict_1.default.equal(r.commanded_stage, 0);
        strict_1.default.match(r.reason_de, /Ein\/Aus/);
    });
    (0, node_test_1.it)("multi-stage picks highest affordable stage", () => {
        const r = (0, thermal_js_1.planThermal)({
            surplusW: 2500,
            bufferTempC: 50,
            thermalMode: "auto",
            governanceEnabled: true,
            config: CFG,
        });
        strict_1.default.equal(r.commanded_stage, 1);
        strict_1.default.equal(r.commanded_power_w, 2000);
    });
    (0, node_test_1.it)("respects max temp", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 1700,
            ih_planning_max_temp_c: 60,
        });
        const r = (0, thermal_js_1.planThermal)({
            surplusW: 5000,
            bufferTempC: 60,
            thermalMode: "auto",
            governanceEnabled: true,
            config: cfg,
        });
        strict_1.default.equal(r.commanded_stage, 0);
    });
});
(0, node_test_1.describe)("planner battery", () => {
    (0, node_test_1.it)("blocks on evcc hold", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "hold",
            evccBatteryDischargeControl: true,
            userIntentBatteryHold: false,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 3000,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            thermalAllocatedW: 2000,
        });
        strict_1.default.equal(r.action, "none");
    });
    (0, node_test_1.it)("charges from remaining surplus", () => {
        const constraints = (0, battery_js_1.buildPlannerConstraints)({
            evccBatteryMode: "normal",
            evccBatteryDischargeControl: false,
            userIntentBatteryHold: false,
        });
        const r = (0, battery_js_1.planBattery)({
            surplusW: 3000,
            socPct: 80,
            governanceEnabled: true,
            constraints,
            thermalAllocatedW: 2000,
        });
        strict_1.default.equal(r.action, "charge");
        strict_1.default.equal(r.max_charge_w, 1000);
    });
});

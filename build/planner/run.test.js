"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("../addons/immersion_heater/device_config.js");
const mode_policy_js_1 = require("./mode_policy.js");
const run_js_1 = require("./run.js");
const battery_winter_test_util_js_1 = require("./battery_winter_test_util.js");
const NOW = new Date("2026-07-04T08:00:00Z");
const BALANCED = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced");
function baseInputs(overrides = {}) {
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
        immersionConfig: (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_stage_1_nominal_power_w: 2000,
            ih_planning_max_temp_c: 60,
        }),
        pvTodayKwh: 12,
        pvTomorrowKwh: 12,
        pvBiasStatus: "ready",
        forecastModeEnabled: false,
        aiOptimizationAllowed: false,
        acConfig: {
            outdoorMaxPowerW: 1300,
            plannerOutdoorLikelyTempC: 28,
            defaultProfileId: "generic",
            units: [],
        },
        coolingGovernanceEnabled: false,
        outdoorTempC: null,
        coolingUnits: [],
        batteryWinterConfig: (0, battery_winter_test_util_js_1.defaultBatteryWinterConfig)(),
        batteryWinterDays: (0, battery_winter_test_util_js_1.defaultBatteryWinterDays)(),
        snowCoverSuspected: false,
        batteryAiAllowed: false,
        ...overrides,
    };
}
(0, node_test_1.describe)("planner run", () => {
    (0, node_test_1.it)("prioritizes heater then battery on surplus", () => {
        (0, run_js_1.resetPlannerRevisionForTest)();
        const intent = (0, run_js_1.runPlanner)(baseInputs());
        strict_1.default.equal(intent.surplus_w, 4500);
        strict_1.default.equal(intent.thermal.commanded_stage, 1);
        strict_1.default.equal(intent.battery.action, "charge");
        strict_1.default.ok(intent.battery.max_charge_w >= 2000);
    });
    (0, node_test_1.it)("skips battery on evcc hold", () => {
        (0, run_js_1.resetPlannerRevisionForTest)();
        const intent = (0, run_js_1.runPlanner)(baseInputs({
            evccBatteryMode: "hold",
            evccBatteryDischargeControl: true,
        }));
        strict_1.default.equal(intent.constraints.battery_hold_active, true);
        strict_1.default.equal(intent.battery.action, "hold");
        strict_1.default.equal(intent.thermal.commanded_stage, 1);
    });
    (0, node_test_1.it)("comfort uses battery on cloud deficit", () => {
        (0, run_js_1.resetPlannerRevisionForTest)();
        const intent = (0, run_js_1.runPlanner)(baseInputs({
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("comfort"),
            globalMode: "comfort",
            pvPowerW: 800,
            houseLoadW: 2500,
            socPct: 60,
        }));
        strict_1.default.equal(intent.deficit_w, 1700);
        strict_1.default.equal(intent.battery.action, "self_consumption");
    });
    (0, node_test_1.it)("off mode blocks planner optimization", () => {
        (0, run_js_1.resetPlannerRevisionForTest)();
        const intent = (0, run_js_1.runPlanner)(baseInputs({
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("off"),
            globalMode: "off",
        }));
        strict_1.default.equal(intent.thermal.commanded_stage, 0);
        strict_1.default.equal(intent.battery.action, "none");
    });
});

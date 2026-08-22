"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("../device_config.js");
const live_surplus_hold_js_1 = require("./live_surplus_hold.js");
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_stage_count: 1,
    ih_stage_1_nominal_power_w: 1700,
    ih_stage_1_set_state: "s1",
    ih_stage_1_enabled: true,
    ih_planning_max_temp_c: 65,
});
(0, node_test_1.describe)("immersion live surplus hold", () => {
    (0, node_test_1.it)("adds running IH power back into surplus (house load includes heater)", () => {
        strict_1.default.equal((0, live_surplus_hold_js_1.computeEffectivePvSurplusW)(5000, 4000, 1700), 2700);
        strict_1.default.equal((0, live_surplus_hold_js_1.computeEffectivePvSurplusW)(5000, 4000, null), 1000);
    });
    (0, node_test_1.it)("holds when surplus covers min stage and buffer below target", () => {
        const r = (0, live_surplus_hold_js_1.computeImmersionLiveSurplusHold)({
            pvPowerW: 5000,
            houseLoadW: 4000,
            immersionOnPowerW: 1700,
            bufferTempC: 45,
            targetTempC: 58,
            planningMaxTempC: 65,
            continueHeating: true,
            config: CFG,
        });
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.stageIndex, 1);
        strict_1.default.equal(r.stagePowerW, 1700);
        strict_1.default.match(r.reasonDe, /Durchlauf/);
    });
    (0, node_test_1.it)("inactive without continueHeating", () => {
        const r = (0, live_surplus_hold_js_1.computeImmersionLiveSurplusHold)({
            pvPowerW: 5000,
            houseLoadW: 1000,
            immersionOnPowerW: null,
            bufferTempC: 45,
            targetTempC: 58,
            planningMaxTempC: 65,
            continueHeating: false,
            config: CFG,
        });
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("inactive when surplus too low", () => {
        const r = (0, live_surplus_hold_js_1.computeImmersionLiveSurplusHold)({
            pvPowerW: 2000,
            houseLoadW: 1900,
            immersionOnPowerW: null,
            bufferTempC: 45,
            targetTempC: 58,
            planningMaxTempC: 65,
            continueHeating: true,
            config: CFG,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.match(r.reasonDe, /unter Stufe/);
    });
    (0, node_test_1.it)("inactive at planning target", () => {
        const r = (0, live_surplus_hold_js_1.computeImmersionLiveSurplusHold)({
            pvPowerW: 5000,
            houseLoadW: 1000,
            immersionOnPowerW: null,
            bufferTempC: 58,
            targetTempC: 58,
            planningMaxTempC: 65,
            continueHeating: true,
            config: CFG,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.match(r.reasonDe, /Tagesziel/);
    });
});

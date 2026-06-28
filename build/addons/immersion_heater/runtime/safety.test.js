"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const safety_js_1 = require("./safety.js");
const device_config_js_1 = require("../device_config.js");
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_buffer_temp_c_target: "t",
    ih_actual_power_state: "p",
    ih_stage_1_nominal_power_w: 3000,
});
(0, node_test_1.describe)("immersion safety", () => {
    (0, node_test_1.it)("no measurement yields no fault", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: true,
            commandedOn: true,
            commandedStage: 1,
            nominalPowerW: 3000,
            measuredPowerW: null,
            hasPowerMeasurement: false,
            feedbackActive: false,
            emsOnWriteAtMs: 0,
            emsOffWriteAtMs: null,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "none");
    });
    (0, node_test_1.it)("no_power_when_on after delay", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: true,
            commandedOn: true,
            commandedStage: 1,
            nominalPowerW: 3000,
            measuredPowerW: 5,
            hasPowerMeasurement: true,
            feedbackActive: false,
            emsOnWriteAtMs: 0,
            emsOffWriteAtMs: null,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "no_power_when_on");
    });
    (0, node_test_1.it)("power_when_off detects stuck relay after EMS wrote off", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: true,
            commandedOn: false,
            commandedStage: 0,
            nominalPowerW: 0,
            measuredPowerW: 500,
            hasPowerMeasurement: true,
            feedbackActive: false,
            emsOnWriteAtMs: null,
            emsOffWriteAtMs: 0,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "power_when_off");
    });
    (0, node_test_1.it)("power_when_off also fires on stuck feedback without power measurement", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: true,
            commandedOn: false,
            commandedStage: 0,
            nominalPowerW: 0,
            measuredPowerW: null,
            hasPowerMeasurement: false,
            feedbackActive: true,
            emsOnWriteAtMs: null,
            emsOffWriteAtMs: 0,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "power_when_off");
    });
    (0, node_test_1.it)("dryrun never raises a power fault (EMS does not own the relay)", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: false,
            commandedOn: false,
            commandedStage: 0,
            nominalPowerW: 0,
            measuredPowerW: 500,
            hasPowerMeasurement: true,
            feedbackActive: true,
            emsOnWriteAtMs: null,
            emsOffWriteAtMs: 0,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "none");
        strict_1.default.equal(r.lockout, false);
    });
    (0, node_test_1.it)("power_when_off does not fire before EMS itself wrote off", () => {
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 100_000,
            executionLive: true,
            commandedOn: false,
            commandedStage: 0,
            nominalPowerW: 0,
            measuredPowerW: 500,
            hasPowerMeasurement: true,
            feedbackActive: true,
            emsOnWriteAtMs: null,
            emsOffWriteAtMs: null,
            mismatchSinceMs: null,
            config: CFG,
        });
        strict_1.default.equal(r.faultCode, "none");
    });
    (0, node_test_1.it)("power_when_off waits for the off-check delay", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "r",
            ih_buffer_temp_c_target: "t",
            ih_actual_power_state: "p",
            ih_stage_1_nominal_power_w: 3000,
            ih_switch_off_check_delay_sec: 30,
        });
        const r = (0, safety_js_1.checkPowerFault)({
            nowMs: 10_000,
            executionLive: true,
            commandedOn: false,
            commandedStage: 0,
            nominalPowerW: 0,
            measuredPowerW: 500,
            hasPowerMeasurement: true,
            feedbackActive: false,
            emsOnWriteAtMs: null,
            emsOffWriteAtMs: 0,
            mismatchSinceMs: null,
            config: cfg,
        });
        strict_1.default.equal(r.faultCode, "none");
    });
    (0, node_test_1.it)("relay chatter detection", () => {
        let t = { timestampsMs: [] };
        for (let i = 0; i < 8; i++) {
            t = (0, safety_js_1.recordChatterEvent)(t, i * 1000, 300);
        }
        strict_1.default.equal((0, safety_js_1.isRelayChatter)(t, 6), true);
    });
    (0, node_test_1.it)("fault reset rejected with power present", () => {
        const r = (0, safety_js_1.canResetFault)({
            allStagesOff: true,
            measuredPowerW: 100,
            hasPowerMeasurement: true,
            powerOffThresholdW: 20,
            configValid: true,
            temperatureValid: true,
            chatterActive: false,
        });
        strict_1.default.equal(r.ok, false);
    });
});

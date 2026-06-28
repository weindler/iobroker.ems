"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fsm_js_1 = require("./fsm.js");
const device_config_js_1 = require("../device_config.js");
const persist_js_1 = require("./persist.js");
const NOW = new Date("2026-06-27T14:00:00Z").getTime();
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_buffer_temp_c_target: "t",
    ih_stage_1_nominal_power_w: 3000,
    ih_planning_max_temp_c: 60,
    ih_planning_min_temp_c: 48,
});
(0, node_test_1.describe)("immersion governance fsm", () => {
    (0, node_test_1.it)("disabled addon prevents heating even in force mode", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: false,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "force",
            forceTargetTempC: 60,
            forceUntilMs: null,
            temperature: { valueC: 40, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.commandedStage, 0);
    });
});

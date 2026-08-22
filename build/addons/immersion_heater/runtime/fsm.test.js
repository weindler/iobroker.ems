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
(0, node_test_1.describe)("immersion fsm", () => {
    (0, node_test_1.it)("off prevents heating", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "off",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: null,
            temperature: { valueC: 40, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.equal(r.state, "off");
    });
    (0, node_test_1.it)("force waits for pause", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "force",
            forceTargetTempC: 60,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: null,
            temperature: { valueC: 50, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), pauseUntilMs: NOW + 120_000 },
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "force_waiting_for_pause");
    });
    (0, node_test_1.it)("force target already reached reverts", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "force",
            forceTargetTempC: 60,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: null,
            temperature: { valueC: 61, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.autoRevertToAuto, true);
    });
    (0, node_test_1.it)("stale temperature blocks force", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "force",
            forceTargetTempC: 60,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: null,
            temperature: (0, fsm_js_1.evaluateTemperature)(50, NOW - 600_000, NOW, CFG),
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.match(r.reason, /stale/);
    });
    (0, node_test_1.it)("auto planner stage starts heating", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: null,
            temperature: { valueC: 50, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.equal(r.commandedPowerW, 3000);
    });
    (0, node_test_1.it)("auto live surplus hold bypasses minimum pause when planner wants heat", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: 58,
            temperature: { valueC: 50, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), pauseUntilMs: NOW + 120_000 },
            config: CFG,
            faultLockout: false,
            faultCode: "none",
            liveSurplusHoldActive: true,
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.notEqual(r.reason, "auto_minimum_pause");
    });
    (0, node_test_1.it)("auto planner target stops heating below hard max", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: 54,
            temperature: { valueC: 55, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_ready");
        strict_1.default.equal(r.reason, "auto_planning_target_reached");
        strict_1.default.equal(r.commandedStage, 0);
    });
    (0, node_test_1.it)("auto reheat hysteresis blocks only when planner wants OFF (local/fallback taktschutz)", () => {
        // CFG: ih_temperature_hysteresis_k default = 2 K, autoTargetC = 60 (kein plannerTargetTempC).
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: null,
            temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), autoTargetReached: true },
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_ready");
        strict_1.default.equal(r.reason, "auto_reheat_hysteresis");
        strict_1.default.equal(r.commandedStage, 0);
    });
    (0, node_test_1.it)("explicit planner stage > 0 is NOT blocked by reheat hysteresis (unified preload)", () => {
        // Beta-Fall: Buf 49 °C, Re-Enable erst unter 46,6 °C, Unified will 1700 W jetzt.
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: true,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: 51.6,
            temperature: { valueC: 49, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), autoTargetReached: true, commandedStage: 0 },
            config: {
                ...CFG,
                temperatureHysteresisK: 5,
                planningMinTempC: 44,
                planningMaxTempC: 63,
            },
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.equal(r.reason, "auto_planner_heating");
        strict_1.default.notEqual(r.reason, "auto_reheat_hysteresis");
    });
    (0, node_test_1.it)("auto reheat hysteresis does NOT block restart if target was never reached (PV dip before full charge)", () => {
        // Heizstab stoppte z.B. wegen kurzer Überschuss-Lücke bei 59°C, bevor autoTargetC (60) je
        // erreicht wurde. persist.autoTargetReached bleibt false → darf beim nächsten Überschuss
        // sofort weiterheizen statt bis (Ziel − Hysterese) zu warten.
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: null,
            temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.equal(r.autoTargetReached, false);
    });
    (0, node_test_1.it)("auto reheat hysteresis allows restart once below (target - hysteresis), resetting the reached-flag", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: null,
            temperature: { valueC: 57.9, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), autoTargetReached: true },
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.equal(r.autoTargetReached, false);
    });
    (0, node_test_1.it)("reaching autoTargetC sets autoTargetReached for later hysteresis gating", () => {
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 0,
            plannerTargetTempC: 54,
            temperature: { valueC: 54, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.reason, "auto_planning_target_reached");
        strict_1.default.equal(r.autoTargetReached, true);
    });
    (0, node_test_1.it)("auto reheat hysteresis does not interrupt an already-running heating cycle", () => {
        // persist.commandedStage > 0 (bereits am Heizen) → Hysterese-Block greift nicht,
        // normale Weiterführung bis temp >= autoTargetC.
        const r = (0, fsm_js_1.runImmersionFsm)({
            nowMs: NOW,
            addonEnabled: true,
            addonAvailable: true,
            configValid: true,
            executionLive: false,
            failsafeActive: false,
            resolvedMode: "auto",
            forceTargetTempC: null,
            forceUntilMs: null,
            plannerCommandedStage: 1,
            plannerTargetTempC: null,
            temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
            measuredPowerW: 0,
            hasPowerMeasurement: false,
            persist: { ...(0, persist_js_1.emptyPersist)(), commandedStage: 1 },
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
    });
    (0, node_test_1.it)("control mode maps to operating_request", () => {
        strict_1.default.equal((0, fsm_js_1.controlModeToOperatingRequest)("force"), "force_on");
        strict_1.default.equal((0, fsm_js_1.controlModeToOperatingRequest)("off"), "off");
    });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.controlModeToOperatingRequest = exports.operatingRequestToControlMode = exports.evaluateTemperature = exports.runImmersionFsm = void 0;
const device_config_1 = require("../device_config");
function runImmersionFsm(input) {
    const { nowMs, addonEnabled, addonAvailable, configValid, failsafeActive, resolvedMode, forceTargetTempC, forceUntilMs, temperature, measuredPowerW, hasPowerMeasurement, persist, config, faultLockout, faultCode, } = input;
    const base = {
        state: "off",
        available: false,
        commandedStage: 0,
        commandedPowerW: 0,
        reason: "",
        faultCode,
        faultLockout,
        faultMessage: "",
        powerVerificationStatus: hasPowerMeasurement ? "unverified" : "unavailable",
        minRuntimeUntilMs: persist.minRuntimeUntilMs,
        pauseUntilMs: persist.pauseUntilMs,
        autoRevertToAuto: false,
        clearForceFields: false,
    };
    if (!addonEnabled || !addonAvailable) {
        return { ...base, state: "disabled", reason: "addon_disabled" };
    }
    if (!configValid) {
        return { ...base, state: "invalid_config", reason: "invalid_configuration" };
    }
    if (faultLockout && faultCode !== "none") {
        return {
            ...base,
            state: "fault_lockout",
            available: false,
            faultLockout: true,
            faultMessage: faultCode,
            reason: "fault_lockout",
        };
    }
    if (failsafeActive) {
        return { ...base, state: "off", reason: "failsafe_active", commandedStage: 0 };
    }
    if (temperature.status !== "valid") {
        const st = temperature.status === "missing" ? "sensor_unavailable" : "sensor_unavailable";
        return {
            ...base,
            state: st,
            available: resolvedMode === "auto",
            reason: `temperature_${temperature.status}`,
            commandedStage: 0,
        };
    }
    if (resolvedMode === "off") {
        const minRuntimeActive = persist.minRuntimeUntilMs !== null && nowMs < persist.minRuntimeUntilMs;
        if (minRuntimeActive) {
            return {
                ...base,
                state: "off",
                reason: "off_overrides_min_runtime",
                commandedStage: 0,
                minRuntimeUntilMs: null,
            };
        }
        return { ...base, state: "off", reason: "user_off", commandedStage: 0, available: false };
    }
    if (resolvedMode === "auto") {
        return {
            ...base,
            state: "auto_ready",
            available: true,
            reason: "auto_ready_for_planner",
            commandedStage: 0,
        };
    }
    // force
    const target = (0, device_config_1.effectiveForceTarget)(config, forceTargetTempC);
    const temp = temperature.valueC;
    const reheatThreshold = target - config.temperatureHysteresisK;
    if (temp >= target) {
        return {
            ...base,
            state: "force_target_reached",
            available: true,
            reason: "force_target_already_reached",
            commandedStage: 0,
            autoRevertToAuto: true,
            clearForceFields: true,
        };
    }
    if (forceUntilMs !== null && nowMs >= forceUntilMs) {
        return {
            ...base,
            state: "force_target_reached",
            available: true,
            reason: "force_until_expired",
            commandedStage: 0,
            autoRevertToAuto: true,
            clearForceFields: true,
        };
    }
    if (persist.pauseUntilMs !== null && nowMs < persist.pauseUntilMs) {
        return {
            ...base,
            state: "force_waiting_for_pause",
            available: true,
            reason: "minimum_pause",
            commandedStage: 0,
            pauseUntilMs: persist.pauseUntilMs,
        };
    }
    const stage = config.stages.find((s) => s.index === config.forceDefaultStage);
    if (!stage?.enabled || !stage.setStateId || stage.nominalPowerW <= 0) {
        return {
            ...base,
            state: "invalid_config",
            reason: "force_default_stage_unavailable",
            commandedStage: 0,
        };
    }
    if (persist.commandedStage > 0 && temp >= reheatThreshold && temp < target) {
        return {
            ...base,
            state: "force_target_reached",
            available: true,
            reason: "force_hysteresis_off",
            commandedStage: 0,
        };
    }
    const minRuntimeActive = persist.minRuntimeUntilMs !== null && nowMs < persist.minRuntimeUntilMs;
    if (minRuntimeActive && persist.commandedStage > 0) {
        return {
            ...base,
            state: "force_heating",
            available: true,
            reason: "minimum_runtime",
            commandedStage: persist.commandedStage,
            commandedPowerW: stage.nominalPowerW,
            minRuntimeUntilMs: persist.minRuntimeUntilMs,
            powerVerificationStatus: evaluatePower(hasPowerMeasurement, measuredPowerW, stage.nominalPowerW, true, config),
        };
    }
    return {
        ...base,
        state: "force_heating",
        available: true,
        reason: "force_heating",
        commandedStage: stage.index,
        commandedPowerW: stage.nominalPowerW,
        minRuntimeUntilMs: nowMs + config.minimumRuntimeSec * 1000,
        powerVerificationStatus: evaluatePower(hasPowerMeasurement, measuredPowerW, stage.nominalPowerW, true, config),
    };
}
exports.runImmersionFsm = runImmersionFsm;
function evaluatePower(hasMeasurement, measured, nominal, on, config) {
    if (!hasMeasurement || measured === null)
        return "unavailable";
    if (on && measured >= config.powerOnThresholdW)
        return "verified";
    if (!on && measured <= config.powerOffThresholdW)
        return "verified";
    return "unverified";
}
function evaluateTemperature(value, observedAtMs, nowMs, config) {
    if (value === null || !Number.isFinite(value)) {
        return { valueC: null, status: "missing", observedAtMs };
    }
    if (value < config.temperaturePlausibleMinC || value > config.temperaturePlausibleMaxC) {
        return { valueC: value, status: "implausible", observedAtMs };
    }
    if (observedAtMs === null || nowMs - observedAtMs > config.temperatureMaxAgeSec * 1000) {
        return { valueC: value, status: "stale", observedAtMs };
    }
    return { valueC: value, status: "valid", observedAtMs };
}
exports.evaluateTemperature = evaluateTemperature;
function operatingRequestToControlMode(op) {
    if (op === "off")
        return "off";
    if (op === "force_on" || op === "force_off")
        return "force";
    return "auto";
}
exports.operatingRequestToControlMode = operatingRequestToControlMode;
function controlModeToOperatingRequest(mode) {
    if (mode === "off")
        return "off";
    if (mode === "force")
        return "force_on";
    return "auto";
}
exports.controlModeToOperatingRequest = controlModeToOperatingRequest;

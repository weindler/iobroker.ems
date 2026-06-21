"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceLabelFromStateId = exports.configIsValid = exports.thermalRuntimeConfigFromAdapter = void 0;
const constants_1 = require("./constants");
function strField(config, key) {
    const v = config[key];
    return typeof v === "string" ? v.trim() : "";
}
function boolField(config, key, defaultVal) {
    const v = config[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["1", "true", "on", "yes", "ja"].includes(s))
            return true;
        if (["0", "false", "off", "no", "nein"].includes(s))
            return false;
    }
    return defaultVal;
}
function numField(config, key, defaultVal, min, max) {
    const raw = config[key];
    const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
    if (!Number.isFinite(n))
        return defaultVal;
    return Math.min(max, Math.max(min, n));
}
function thermalRuntimeConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        enabled: boolField(c, "learning_thermal_runtime_enabled", true),
        lookbackDays: Math.round(numField(c, "learning_thermal_runtime_lookback_days", constants_1.DEFAULT_LOOKBACK_DAYS, 7, 365)),
        temperatureStateId: strField(c, "learning_thermal_runtime_temperature_state"),
        fullThresholdC: numField(c, "learning_thermal_runtime_full_threshold_c", constants_1.DEFAULT_FULL_THRESHOLD_C, 1, 110),
        emptyThresholdC: numField(c, "learning_thermal_runtime_empty_threshold_c", constants_1.DEFAULT_EMPTY_THRESHOLD_C, 0, 109),
        minRuntimeHours: numField(c, "learning_thermal_runtime_min_runtime_hours", constants_1.DEFAULT_MIN_RUNTIME_HOURS, 0.1, 24),
        maxRuntimeHours: numField(c, "learning_thermal_runtime_max_runtime_hours", constants_1.DEFAULT_MAX_RUNTIME_HOURS, 1, 168),
    };
}
exports.thermalRuntimeConfigFromAdapter = thermalRuntimeConfigFromAdapter;
function configIsValid(cfg) {
    return cfg.fullThresholdC > cfg.emptyThresholdC && cfg.maxRuntimeHours >= cfg.minRuntimeHours;
}
exports.configIsValid = configIsValid;
function sourceLabelFromStateId(stateId) {
    const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
    return m ? m[1] : stateId.split(".")[0] || "unknown";
}
exports.sourceLabelFromStateId = sourceLabelFromStateId;

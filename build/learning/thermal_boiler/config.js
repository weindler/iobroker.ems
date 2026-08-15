"use strict";
/**
 * Boiler-Learning A — eigene Schwellen, nie Puffer-empty/full aus thermal_runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.thermalBoilerConfigFromAdapter = void 0;
const constants_1 = require("../thermal_runtime/constants");
function numField(config, key, defaultVal, min, max) {
    const raw = config[key];
    const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
    if (!Number.isFinite(n))
        return defaultVal;
    return Math.min(max, Math.max(min, n));
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
/** Lookback/Fenster dürfen thermal_runtime teilen — Schwellen kommen vom Boiler. */
function thermalBoilerConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const emptyThresholdC = numField(c, "ih_boiler_min_temp_c", 50, 0, 109);
    const fullThresholdC = numField(c, "ih_hygiene_target_temp_c", 60, 1, 110);
    return {
        enabled: boolField(c, "learning_thermal_runtime_enabled", true),
        lookbackDays: Math.round(numField(c, "learning_thermal_runtime_lookback_days", constants_1.DEFAULT_LOOKBACK_DAYS, 7, 365)),
        temperatureStateId: "",
        fullThresholdC: Math.max(fullThresholdC, emptyThresholdC + 1),
        emptyThresholdC,
        minRuntimeHours: numField(c, "learning_thermal_runtime_min_runtime_hours", constants_1.DEFAULT_MIN_RUNTIME_HOURS, 0.1, 24),
        maxRuntimeHours: numField(c, "learning_thermal_runtime_max_runtime_hours", constants_1.DEFAULT_MAX_RUNTIME_HOURS, 1, 168),
    };
}
exports.thermalBoilerConfigFromAdapter = thermalBoilerConfigFromAdapter;

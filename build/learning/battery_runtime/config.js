"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceLabelFromStateId = exports.nightAstroConfigReady = exports.batteryRuntimeConfigFromAdapter = void 0;
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
function timeField(config, key, defaultVal) {
    const v = strField(config, key);
    return /^\d{1,2}:\d{2}$/.test(v) ? v : defaultVal;
}
function batteryRuntimeConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        enabled: boolField(c, "learning_battery_runtime_enabled", true),
        lookbackDays: Math.round(numField(c, "learning_battery_runtime_lookback_days", constants_1.DEFAULT_LOOKBACK_DAYS, 7, 365)),
        socStateId: strField(c, "learning_battery_runtime_soc_state"),
        powerStateId: strField(c, "learning_battery_runtime_power_state"),
        powerInvert: boolField(c, "learning_battery_runtime_power_invert", false),
        capacityStateId: strField(c, "learning_battery_runtime_capacity_state"),
        fullChargeSoc: numField(c, "learning_battery_runtime_full_charge_soc", constants_1.DEFAULT_FULL_CHARGE_SOC, 80, 100),
        topoffIntervalDays: Math.round(numField(c, "learning_battery_runtime_topoff_interval_days", constants_1.DEFAULT_TOPOFF_INTERVAL_DAYS, 1, 90)),
        nightStart: timeField(c, "learning_battery_runtime_night_start", constants_1.DEFAULT_NIGHT_START),
        nightEnd: timeField(c, "learning_battery_runtime_night_end", constants_1.DEFAULT_NIGHT_END),
        nightAstroEnabled: boolField(c, "learning_battery_runtime_night_astro_enabled", false),
        nightStartStateId: strField(c, "learning_battery_runtime_night_start_state"),
        nightEndStateId: strField(c, "learning_battery_runtime_night_end_state"),
    };
}
exports.batteryRuntimeConfigFromAdapter = batteryRuntimeConfigFromAdapter;
function nightAstroConfigReady(cfg) {
    return cfg.nightAstroEnabled && Boolean(cfg.nightStartStateId && cfg.nightEndStateId);
}
exports.nightAstroConfigReady = nightAstroConfigReady;
function sourceLabelFromStateId(stateId) {
    if (!stateId)
        return "none";
    const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
    return m ? m[1] : stateId.split(".")[0] || "unknown";
}
exports.sourceLabelFromStateId = sourceLabelFromStateId;

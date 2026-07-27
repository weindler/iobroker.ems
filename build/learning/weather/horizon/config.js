"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weatherHorizonHasAnyMapping = exports.weatherHorizonConfigFromAdapter = void 0;
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
/** Admin keys: learning_weather_horizon_day{N}_{min|max}_temp_state */
function weatherHorizonConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const days = [];
    for (const dayIndex of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
        days.push({
            dayIndex,
            minTempStateId: strField(c, `learning_weather_horizon_day${dayIndex}_min_temp_state`),
            maxTempStateId: strField(c, `learning_weather_horizon_day${dayIndex}_max_temp_state`),
        });
    }
    return {
        enabled: boolField(c, "learning_weather_horizon_enabled", true),
        days,
    };
}
exports.weatherHorizonConfigFromAdapter = weatherHorizonConfigFromAdapter;
function weatherHorizonHasAnyMapping(cfg) {
    return cfg.days.some((d) => d.minTempStateId || d.maxTempStateId);
}
exports.weatherHorizonHasAnyMapping = weatherHorizonHasAnyMapping;

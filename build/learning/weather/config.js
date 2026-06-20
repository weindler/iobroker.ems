"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceLabelFromStateId = exports.weatherConfigReady = exports.weatherConfigFromAdapter = void 0;
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
const FORECAST_CONFIG_KEYS = {
    temp: "learning_weather_forecast_temp_state",
    cloud: "learning_weather_forecast_cloud_state",
    rain: "learning_weather_forecast_rain_state",
    wind: "learning_weather_forecast_wind_state",
};
const ACTUAL_CONFIG_KEYS = {
    temp: "learning_weather_actual_temp_state",
    cloud: "learning_weather_actual_cloud_state",
    rain: "learning_weather_actual_rain_state",
    wind: "learning_weather_actual_wind_state",
};
function weatherConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const intervalRaw = c.learning_weather_interval_sec;
    const intervalN = typeof intervalRaw === "number" ? intervalRaw : parseInt(String(intervalRaw ?? ""), 10);
    const intervalSec = Number.isFinite(intervalN) && intervalN >= 300 && intervalN <= 86400
        ? Math.round(intervalN)
        : constants_1.DEFAULT_INTERVAL_SEC;
    const metrics = {};
    for (const key of constants_1.METRIC_KEYS) {
        const forecastStateId = strField(c, FORECAST_CONFIG_KEYS[key]);
        const actualStateId = strField(c, ACTUAL_CONFIG_KEYS[key]);
        if (forecastStateId && actualStateId) {
            metrics[key] = { forecastStateId, actualStateId };
        }
    }
    return {
        enabled: boolField(c, "learning_weather_enabled", true),
        intervalSec,
        metrics,
    };
}
exports.weatherConfigFromAdapter = weatherConfigFromAdapter;
function weatherConfigReady(cfg) {
    return Object.keys(cfg.metrics).length > 0;
}
exports.weatherConfigReady = weatherConfigReady;
/** Kurzlabel aus State-ID, z. B. brightsky.0… → brightsky */
function sourceLabelFromStateId(stateId) {
    const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
    return m ? m[1] : stateId.split(".")[0] || "unknown";
}
exports.sourceLabelFromStateId = sourceLabelFromStateId;

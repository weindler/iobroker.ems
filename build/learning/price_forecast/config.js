"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFreezeTimeHHMM = exports.sourceLabelFromStateId = exports.priceForecastConfigReady = exports.priceForecastConfigFromAdapter = void 0;
const config_1 = require("../pv_bias/config");
Object.defineProperty(exports, "parseFreezeTimeHHMM", { enumerable: true, get: function () { return config_1.parseFreezeTimeHHMM; } });
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
function priceForecastConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const lookbackRaw = c.learning_price_forecast_lookback_days;
    const lookbackN = typeof lookbackRaw === "number" ? lookbackRaw : parseInt(String(lookbackRaw ?? ""), 10);
    const lookbackDays = Number.isFinite(lookbackN) && lookbackN >= 7 && lookbackN <= 365
        ? Math.round(lookbackN)
        : constants_1.DEFAULT_LOOKBACK_DAYS;
    const freezeTimeRaw = strField(c, "learning_price_forecast_freeze_time") || constants_1.DEFAULT_FREEZE_TIME;
    return {
        enabled: boolField(c, "learning_price_forecast_enabled", true),
        freezeEnabled: boolField(c, "learning_price_forecast_freeze_enabled", true),
        freezeTime: (0, config_1.normalizeFreezeTime)(freezeTimeRaw),
        todayJsonStateId: strField(c, "learning_price_forecast_today_json_state"),
        tomorrowJsonStateId: strField(c, "learning_price_forecast_tomorrow_json_state"),
        actualStateId: strField(c, "learning_price_forecast_actual_state"),
        lookbackDays,
    };
}
exports.priceForecastConfigFromAdapter = priceForecastConfigFromAdapter;
function priceForecastConfigReady(cfg) {
    return Boolean(cfg.tomorrowJsonStateId && cfg.actualStateId);
}
exports.priceForecastConfigReady = priceForecastConfigReady;
function sourceLabelFromStateId(stateId) {
    const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
    return m ? m[1] : stateId.split(".")[0] || "unknown";
}
exports.sourceLabelFromStateId = sourceLabelFromStateId;

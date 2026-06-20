"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvHorizonConfigFromAdapter = exports.hasPvForecastTodayTomorrow = void 0;
const constants_1 = require("./constants");
const config_1 = require("../pv_bias/config");
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
const DAY_RAW_CONFIG_KEYS = [
    "learning_pv_horizon_day1_raw_state",
    "learning_pv_horizon_day2_raw_state",
    "learning_pv_horizon_day3_raw_state",
    "learning_pv_horizon_day4_raw_state",
    "learning_pv_horizon_day5_raw_state",
    "learning_pv_horizon_day6_raw_state",
    "learning_pv_horizon_day7_raw_state",
];
/** PV-Forecast für heute und morgen in Phase 2A konfiguriert → Horizon dupliziert diese Tage nicht. */
function hasPvForecastTodayTomorrow(config) {
    const biasCfg = (0, config_1.pvBiasConfigFromAdapter)(config);
    return Boolean(biasCfg.rawTodayStateId && biasCfg.rawTomorrowStateId);
}
exports.hasPvForecastTodayTomorrow = hasPvForecastTodayTomorrow;
function pvHorizonConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const biasCfg = (0, config_1.pvBiasConfigFromAdapter)(config);
    const skipTodayTomorrow = hasPvForecastTodayTomorrow(config);
    const rawStateIds = [];
    for (let i = 0; i < constants_1.PV_HORIZON_DAY_COUNT; i++) {
        let id = strField(c, DAY_RAW_CONFIG_KEYS[i]);
        if (!skipTodayTomorrow) {
            if (!id && i === 0) {
                id = biasCfg.rawTodayStateId;
            }
            if (!id && i === 1) {
                id = biasCfg.rawTomorrowStateId;
            }
        }
        rawStateIds.push(id);
    }
    return {
        enabled: boolField(c, "learning_pv_horizon_enabled", true),
        rawStateIds,
        skipTodayTomorrowFromPvBias: skipTodayTomorrow,
    };
}
exports.pvHorizonConfigFromAdapter = pvHorizonConfigFromAdapter;

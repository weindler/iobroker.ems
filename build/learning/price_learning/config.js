"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceLabelFromStateId = exports.priceLearningConfigReady = exports.priceLearningConfigFromAdapter = void 0;
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
function priceLearningConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const lookbackRaw = c.learning_price_lookback_days;
    const lookbackN = typeof lookbackRaw === "number" ? lookbackRaw : parseInt(String(lookbackRaw ?? ""), 10);
    const lookbackDays = Number.isFinite(lookbackN) && lookbackN >= 7 && lookbackN <= 365
        ? Math.round(lookbackN)
        : constants_1.DEFAULT_LOOKBACK_DAYS;
    const configuredState = strField(c, "learning_price_source_state");
    return {
        enabled: boolField(c, "learning_price_enabled", true),
        priceStateId: configuredState || constants_1.DEFAULT_PRICE_STATE_ID,
        lookbackDays,
    };
}
exports.priceLearningConfigFromAdapter = priceLearningConfigFromAdapter;
function priceLearningConfigReady(cfg) {
    return Boolean(cfg.priceStateId);
}
exports.priceLearningConfigReady = priceLearningConfigReady;
function sourceLabelFromStateId(stateId) {
    if (stateId === constants_1.DEFAULT_PRICE_STATE_ID) {
        return "ems_live_price";
    }
    const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
    return m ? m[1] : stateId.split(".")[0] || "unknown";
}
exports.sourceLabelFromStateId = sourceLabelFromStateId;

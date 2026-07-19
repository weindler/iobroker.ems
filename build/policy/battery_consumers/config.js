"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryConsumerIdFromAddon = exports.batteryConsumerRule = exports.batteryConsumersConfigFromAdapter = void 0;
const state_util_1 = require("../../ems_light/state_util");
function boolField(c, key, def) {
    const v = c[key];
    if (v === true || v === false)
        return v;
    if (v === "true" || v === 1 || v === "1")
        return true;
    if (v === "false" || v === 0 || v === "0")
        return false;
    return def;
}
function numOrNull(c, key) {
    const n = (0, state_util_1.asNum)(c[key]);
    return n === null || !Number.isFinite(n) ? null : n;
}
function clampSoc(n, def) {
    if (n === null)
        return def;
    return Math.max(0, Math.min(100, n));
}
function ruleFromConfig(c, prefix, defaults) {
    return {
        mayUseBattery: boolField(c, `${prefix}_may_use_battery`, defaults.mayUse),
        onlyWhenCritical: boolField(c, `${prefix}_only_when_critical`, defaults.onlyCritical),
        minSocPct: clampSoc(numOrNull(c, `${prefix}_min_soc_pct`), defaults.minSoc),
        criticalMarginK: defaults.marginK === null ? null : (numOrNull(c, `${prefix}_critical_margin_k`) ?? defaults.marginK),
    };
}
const DEFAULT_MIN_SOC = 50;
function batteryConsumersConfigFromAdapter(config) {
    const c = (config && typeof config === "object" ? config : {});
    return {
        immersion_heater: ruleFromConfig(c, "bat_consumer_immersion", {
            mayUse: false,
            onlyCritical: true,
            minSoc: DEFAULT_MIN_SOC,
            marginK: 2,
        }),
        air_conditioning: ruleFromConfig(c, "bat_consumer_climate", {
            mayUse: false,
            onlyCritical: true,
            minSoc: DEFAULT_MIN_SOC,
            marginK: null,
        }),
        wallbox: ruleFromConfig(c, "bat_consumer_wallbox", {
            mayUse: false,
            onlyCritical: false,
            minSoc: DEFAULT_MIN_SOC,
            marginK: null,
        }),
        maxDischargePowerW: numOrNull(c, "bat_consumer_max_discharge_w"),
    };
}
exports.batteryConsumersConfigFromAdapter = batteryConsumersConfigFromAdapter;
function batteryConsumerRule(cfg, id) {
    return cfg[id];
}
exports.batteryConsumerRule = batteryConsumerRule;
/** Map contribution addon id → battery consumer id (or null). */
function batteryConsumerIdFromAddon(addonId) {
    if (addonId === "immersion_heater")
        return "immersion_heater";
    if (addonId === "air_conditioning" || addonId.startsWith("air_conditioning."))
        return "air_conditioning";
    if (addonId === "wallbox")
        return "wallbox";
    return null;
}
exports.batteryConsumerIdFromAddon = batteryConsumerIdFromAddon;

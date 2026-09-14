"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryConsumerIdFromAddon = exports.batteryConsumerRule = exports.batteryConsumersConfigFromAdapter = exports.DEFAULT_MIN_SOC = void 0;
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
/**
 * Legacy export kept for source compatibility. Consumer-specific fixed SOC floors are no
 * longer used: the central reserve planner determines the dynamic discharge floor.
 */
exports.DEFAULT_MIN_SOC = 50;
function automaticRule(enabled, criticalMarginK) {
    return {
        mayUseBattery: enabled,
        onlyWhenCritical: false,
        minSocPct: null,
        criticalMarginK,
    };
}
/**
 * A single operator consent replaces the former per-consumer switches and fixed SOC floors.
 *
 * The consent only enables automatic planning. Price, forecast, central dynamic reserve,
 * battery hold and hardware limits remain authoritative. Legacy bat_consumer_* settings are
 * deliberately ignored so an old saved checkbox cannot silently reintroduce grid import.
 */
function batteryConsumersConfigFromAdapter(config) {
    const c = (config && typeof config === "object" ? config : {});
    const automaticSupport = boolField(c, "bat_consumer_auto_support", true);
    return {
        immersion_heater: automaticRule(automaticSupport, 2),
        air_conditioning: automaticRule(automaticSupport, null),
        wallbox: automaticRule(automaticSupport, null),
        // The central battery/grid-balance limit is the only power budget.
        maxDischargePowerW: null,
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

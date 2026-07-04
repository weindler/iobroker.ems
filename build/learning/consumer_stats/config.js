"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumerStatsConfigFor = exports.CONSUMER_STATS_CONFIG_READERS = exports.immersionConsumerStatsFromConfig = void 0;
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function boolField(c, key, def) {
    const v = c[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    const s = String(v ?? "").trim().toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return true;
    if (["0", "false", "off", "no", "nein"].includes(s))
        return false;
    return def;
}
function numField(c, key, def) {
    const v = c[key];
    if (v === null || v === undefined || v === "")
        return def;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : def;
}
function immersionConsumerStatsFromConfig(config) {
    const c = configRecord(config);
    return {
        enabled: boolField(c, "ih_stats_enabled", true),
        trackRuntime: boolField(c, "ih_stats_track_runtime", true),
        trackEnergy: boolField(c, "ih_stats_track_energy", true),
        runtimeOffsetSec: Math.max(0, numField(c, "ih_stats_runtime_offset_h", 0) * 3600),
        energyOffsetKwh: Math.max(0, numField(c, "ih_stats_energy_offset_kwh", 0)),
    };
}
exports.immersionConsumerStatsFromConfig = immersionConsumerStatsFromConfig;
exports.CONSUMER_STATS_CONFIG_READERS = {
    immersion_heater: immersionConsumerStatsFromConfig,
};
function consumerStatsConfigFor(addonId, config) {
    const reader = exports.CONSUMER_STATS_CONFIG_READERS[addonId];
    return reader ? reader(config) : null;
}
exports.consumerStatsConfigFor = consumerStatsConfigFor;

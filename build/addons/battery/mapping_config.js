"use strict";
/** Sonnen-Profil: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.winterTickIntervalSecFromConfig = exports.gridBalanceOffsetsFromConfig = exports.featureGridBalanceFromConfig = exports.batteryProfileFromConfig = exports.sonnenBatteryMappingFromConfig = exports.BATTERY_SONNEN_FLAT_PREFIX = exports.BATTERY_SONNEN_MAPPING_ROLES = void 0;
exports.BATTERY_SONNEN_MAPPING_ROLES = [
    "consumption_w",
    "pv_ac_power_w",
    "battery_charging_w",
    "soc_pct",
    "capacity_kwh",
    "operating_mode",
];
exports.BATTERY_SONNEN_FLAT_PREFIX = {
    consumption_w: "bat_consumption",
    pv_ac_power_w: "bat_pv_ac",
    battery_charging_w: "bat_battery_charging",
    soc_pct: "bat_soc",
    capacity_kwh: "bat_capacity_kwh",
    operating_mode: "bat_operating_mode",
};
function sonnenBatteryMappingFromConfig(config) {
    const nested = config.mapping?.battery;
    const out = {};
    for (const role of exports.BATTERY_SONNEN_MAPPING_ROLES) {
        const prefix = exports.BATTERY_SONNEN_FLAT_PREFIX[role];
        const entry = {};
        const t = config[`${prefix}_target`];
        if (typeof t === "string" && t.trim()) {
            entry.target_state = t.trim();
        }
        const en = config[`${prefix}_enabled`];
        if (typeof en === "boolean") {
            entry.enabled = en;
        }
        const nest = nested?.[role];
        if (nest && typeof nest === "object") {
            if (typeof nest.target_state === "string" && nest.target_state.trim()) {
                entry.target_state = nest.target_state.trim();
            }
            if (typeof nest.enabled === "boolean") {
                entry.enabled = nest.enabled;
            }
        }
        if (entry.target_state || typeof entry.enabled === "boolean") {
            out[role] = entry;
        }
    }
    return out;
}
exports.sonnenBatteryMappingFromConfig = sonnenBatteryMappingFromConfig;
function batteryProfileFromConfig(config) {
    const p = config.battery_profile;
    if (typeof p === "string" && p.trim()) {
        return p.trim().toLowerCase();
    }
    return "sonnen";
}
exports.batteryProfileFromConfig = batteryProfileFromConfig;
function featureGridBalanceFromConfig(config) {
    return config.bat_feature_grid_balance_enabled === true;
}
exports.featureGridBalanceFromConfig = featureGridBalanceFromConfig;
function gridBalanceOffsetsFromConfig(config) {
    const c = config;
    const high = c.bat_offset_high_soc_w;
    const low = c.bat_offset_low_soc_w;
    const thr = c.bat_offset_soc_threshold_pct;
    return {
        offsetHighSocW: typeof high === "number" && high >= 0 ? Math.round(high) : 25,
        offsetLowSocW: typeof low === "number" && low >= 0 ? Math.round(low) : 10,
        socThresholdPct: typeof thr === "number" && thr > 0 ? thr : 20,
    };
}
exports.gridBalanceOffsetsFromConfig = gridBalanceOffsetsFromConfig;
function winterTickIntervalSecFromConfig(config) {
    const v = config.bat_winter_tick_interval_sec;
    if (typeof v === "number" && Number.isFinite(v) && v >= 15) {
        return Math.min(300, Math.floor(v));
    }
    return 45;
}
exports.winterTickIntervalSecFromConfig = winterTickIntervalSecFromConfig;

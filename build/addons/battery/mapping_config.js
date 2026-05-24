"use strict";
/** Sonnen-Profil: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeMonthsFromConfig = exports.capacityWhFromConfig = exports.tickIntervalSecFromConfig = exports.batteryProfileFromConfig = exports.sonnenBatteryMappingFromConfig = exports.BATTERY_SONNEN_FLAT_PREFIX = exports.BATTERY_SONNEN_MAPPING_ROLES = void 0;
exports.BATTERY_SONNEN_MAPPING_ROLES = [
    "consumption_w",
    "pv_ac_power_w",
    "battery_charging_w",
    "soc_pct",
    "capacity_wh",
];
exports.BATTERY_SONNEN_FLAT_PREFIX = {
    consumption_w: "bat_consumption",
    pv_ac_power_w: "bat_pv_ac",
    battery_charging_w: "bat_battery_charging",
    soc_pct: "bat_soc",
    capacity_wh: "bat_capacity",
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
function tickIntervalSecFromConfig(config) {
    const v = config.bat_tick_interval_sec;
    if (typeof v === "number" && Number.isFinite(v) && v >= 15) {
        return Math.min(300, Math.floor(v));
    }
    return 45;
}
exports.tickIntervalSecFromConfig = tickIntervalSecFromConfig;
function capacityWhFromConfig(config) {
    const v = config.bat_capacity_wh_const;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        return v;
    }
    return null;
}
exports.capacityWhFromConfig = capacityWhFromConfig;
/** Kalendermonate 1–12 für Sommer-Gate (Blockly-Äquivalent). */
function activeMonthsFromConfig(config) {
    const raw = config.bat_active_months;
    const def = [3, 4, 5, 6, 7, 8, 9, 10];
    if (typeof raw !== "string" || !raw.trim()) {
        return def;
    }
    const s = raw.trim();
    try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
            return parsed
                .map((x) => Number(x))
                .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
        }
    }
    catch {
        /* CSV fallback */
    }
    return s
        .split(/[,;\s]+/)
        .map((x) => Number(x.trim()))
        .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
}
exports.activeMonthsFromConfig = activeMonthsFromConfig;

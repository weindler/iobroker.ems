"use strict";
/** Batterie-Mapping: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.missingMappings = exports.isMappingConfigured = exports.batteryMappingNativeFromConfig = exports.batteryMappingFromConfig = exports.BATTERY_MAPPING_FLAT_PREFIX = exports.BATTERY_MAPPING_ROLES = exports.BATTERY_WRITE_ROLES = exports.BATTERY_READ_ROLES = void 0;
exports.BATTERY_READ_ROLES = [
    "soc_pct",
    "power_w",
    "charging_power_w",
    "discharging_power_w",
    "capacity_kwh",
    "operating_mode_read",
    "online",
    "consumption_w",
    "pv_ac_power_w",
];
exports.BATTERY_WRITE_ROLES = ["set_operating_mode", "set_charge_power"];
exports.BATTERY_MAPPING_ROLES = [...exports.BATTERY_READ_ROLES, ...exports.BATTERY_WRITE_ROLES];
/** Admin-Flat-Präfixe; bewusst rückwärtskompatibel zu v0.1.64-Schlüsseln. */
exports.BATTERY_MAPPING_FLAT_PREFIX = {
    soc_pct: "bat_soc",
    power_w: "bat_power",
    charging_power_w: "bat_charging_power",
    discharging_power_w: "bat_discharging_power",
    capacity_kwh: "bat_capacity_kwh",
    operating_mode_read: "bat_operating_mode_read",
    online: "bat_online",
    consumption_w: "bat_consumption",
    pv_ac_power_w: "bat_pv_ac",
    set_operating_mode: "bat_operating_mode",
    set_charge_power: "bat_battery_charging",
};
function rec(config) {
    return config && typeof config === "object" ? config : {};
}
function batteryMappingFromConfig(config) {
    const c = rec(config);
    const nested = c.mapping?.battery;
    const table = {};
    for (const role of exports.BATTERY_MAPPING_ROLES) {
        const prefix = exports.BATTERY_MAPPING_FLAT_PREFIX[role];
        let enabled = c[`${prefix}_enabled`];
        let target = c[`${prefix}_target`];
        const nest = nested?.[role];
        if (nest && typeof nest === "object") {
            if (typeof nest.enabled === "boolean")
                enabled = nest.enabled;
            if (typeof nest.target_state === "string" && nest.target_state.trim())
                target = nest.target_state;
        }
        const targetState = typeof target === "string" ? target.trim() : "";
        // operating_mode_read defaults to the operating-mode write target if unset.
        table[role] = {
            enabled: typeof enabled === "boolean" ? enabled : true,
            targetState,
        };
    }
    if (!table.operating_mode_read.targetState && table.set_operating_mode.targetState) {
        table.operating_mode_read = {
            enabled: table.set_operating_mode.enabled,
            targetState: table.set_operating_mode.targetState,
        };
    }
    return table;
}
exports.batteryMappingFromConfig = batteryMappingFromConfig;
/** Für mapping_sync: logische Rollen → native Mapping-Einträge. */
function batteryMappingNativeFromConfig(config) {
    const table = batteryMappingFromConfig(config);
    const out = {};
    for (const role of exports.BATTERY_MAPPING_ROLES) {
        const slot = table[role];
        if (slot.targetState || typeof slot.enabled === "boolean") {
            out[role] = { enabled: slot.enabled, target_state: slot.targetState };
        }
    }
    return out;
}
exports.batteryMappingNativeFromConfig = batteryMappingNativeFromConfig;
/** Eine Rolle gilt als konfiguriert, wenn enabled und ein Ziel-State gesetzt ist. */
function isMappingConfigured(table, role) {
    const slot = table[role];
    return !!slot && slot.enabled && slot.targetState.length > 0;
}
exports.isMappingConfigured = isMappingConfigured;
function missingMappings(table, roles) {
    return roles.filter((r) => !isMappingConfigured(table, r));
}
exports.missingMappings = missingMappings;

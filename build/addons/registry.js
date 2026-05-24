"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReadOnlyAddon = exports.addonHasCapability = exports.commandNeedsCapability = exports.ADDON_DEFAULT_CAPABILITIES = exports.EMS_ADDON_IDS = void 0;
/** EMS addon_id list (aligned with EMS snapshot catalog). */
exports.EMS_ADDON_IDS = [
    "sensorics",
    "inverter_1",
    "inverter_2",
    "inverter_3",
    "pv_plant",
    "battery",
    "house_main_fuse",
    "wallbox",
    "heating",
    "heat_pump",
    "immersion_heater",
    "consumer_1",
    "air_conditioning",
    "weather_live",
    "weather_forecast",
    "pv_forecast",
    "series_storage",
    "dynamic_tariff",
    "fixed_tariff",
];
const WALLBOX_COMMANDS = {
    set_enabled: "supports_enable_disable",
    set_current_a: "supports_power_limit",
    set_charge_power_w: "supports_power_limit",
    set_phase_switch_enabled: "supports_phase_switch_mode",
};
const BATTERY_COMMANDS = {
    set_enabled: "supports_enable_disable",
    set_current_a: "supports_power_limit",
    set_charge_power_w: "supports_power_limit",
    set_target_soc: "supports_target_soc",
    emergency_stop: "supports_emergency_stop",
};
const IMMERSION_COMMANDS = {
    set_enabled: "supports_enable_disable",
    set_temperature_target: "supports_temperature_target",
};
/** Default capabilities per addon (no device-specific logic). */
exports.ADDON_DEFAULT_CAPABILITIES = {
    wallbox: [
        "supports_enable_disable",
        "supports_power_limit",
        "supports_phase_switch_mode",
    ],
    battery: [
        "supports_enable_disable",
        "supports_power_limit",
        "supports_target_soc",
        "supports_emergency_stop",
    ],
    immersion_heater: ["supports_enable_disable", "supports_temperature_target"],
    house_main_fuse: ["supports_read_only"],
    sensorics: ["supports_read_only"],
    inverter_1: ["supports_read_only"],
    inverter_2: ["supports_read_only"],
    inverter_3: ["supports_read_only"],
    pv_plant: ["supports_read_only"],
    heating: ["supports_read_only"],
    heat_pump: ["supports_read_only"],
    consumer_1: ["supports_read_only"],
    air_conditioning: ["supports_enable_disable", "supports_mode_switch", "supports_power_limit"],
    weather_live: ["supports_read_only"],
    weather_forecast: ["supports_read_only"],
    pv_forecast: ["supports_read_only"],
    series_storage: ["supports_read_only"],
    dynamic_tariff: ["supports_read_only"],
    fixed_tariff: ["supports_read_only"],
};
const COMMAND_MAP = {
    wallbox: WALLBOX_COMMANDS,
    battery: BATTERY_COMMANDS,
    immersion_heater: IMMERSION_COMMANDS,
};
function commandNeedsCapability(addonId, command) {
    const perAddon = COMMAND_MAP[addonId];
    if (perAddon?.[command])
        return perAddon[command];
    return null;
}
exports.commandNeedsCapability = commandNeedsCapability;
function addonHasCapability(addonId, cap) {
    const list = exports.ADDON_DEFAULT_CAPABILITIES[addonId];
    return list?.includes(cap) ?? false;
}
exports.addonHasCapability = addonHasCapability;
function isReadOnlyAddon(addonId) {
    const list = exports.ADDON_DEFAULT_CAPABILITIES[addonId];
    if (!list?.length)
        return false;
    return list.length === 1 && list[0] === "supports_read_only";
}
exports.isReadOnlyAddon = isReadOnlyAddon;

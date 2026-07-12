"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectPoliciesExport = exports.collectVehicleProfilesExport = exports.filterVehicleProfileRow = exports.collectMappingsExport = exports.collectAdapterConfigExport = exports.filterAllowlistedConfig = exports.isAllowedConfigKey = exports.VEHICLE_PROFILE_ALLOWED_KEYS = void 0;
const execution_mode_1 = require("../execution_mode");
const schema_1 = require("./schema");
/** Erlaubte Native-Config-Präfixe (Allowlist). */
const ALLOWED_PREFIXES = [
    "global_",
    "wallbox_",
    "wb_",
    "bat_",
    "battery_",
    "ih_",
    "immersion_",
    "ac_",
    "climate_",
    "ems_",
    "ems_light_",
    "intent_",
    "planner_",
    "policy_",
    "learning_",
    "operator_",
    "pv_",
    "price_",
    "weather_",
    "house_",
    "thermal_",
    "tariff_",
    "dt_",
];
const ALLOWED_EXACT = new Set(["mapping", "wb_vehicle_profiles"]);
/** Explizite Fahrzeugprofil-Felder (kein „alle Felder außer Secrets“). */
exports.VEHICLE_PROFILE_ALLOWED_KEYS = new Set([
    "vehicle_id",
    "display_name",
    "enabled",
    "is_guest",
    "source",
    "evcc_vehicle_id",
    "evcc_vehicle_name",
    "battery_capacity_net_kwh",
    "max_ac_charge_power_w",
    "supported_phases",
    "preferred_phases",
    "min_current_a",
    "max_current_a",
    "default_target_soc_pct",
    "minimum_departure_soc_pct",
    "maximum_soc_pct",
    "charge_efficiency_pct",
    "reference_range_at_100_pct_km",
    "soc_fallback_max_age_min",
    "soc_state",
    "range_state",
    "connected_state",
    "charging_state",
    "session_energy_state",
    "created_at",
    "updated_at",
]);
const MAPPING_ADDON_KEYS = new Set(["wallbox", "battery", "immersion_heater", "air_conditioning", "climate"]);
const MAPPING_SUBKEY_RE = /(_target|_enabled|_state|_mode)$/;
function isAllowedConfigKey(key) {
    if ((0, schema_1.isSecretKey)(key))
        return false;
    if (ALLOWED_EXACT.has(key))
        return true;
    return ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}
exports.isAllowedConfigKey = isAllowedConfigKey;
function filterAllowlistedConfig(config) {
    const out = {};
    for (const [key, val] of Object.entries(config)) {
        if (!isAllowedConfigKey(key))
            continue;
        if (val !== undefined) {
            out[key] = val;
        }
    }
    return out;
}
exports.filterAllowlistedConfig = filterAllowlistedConfig;
function filterMappingObject(mapping) {
    const out = {};
    for (const [addonKey, addonVal] of Object.entries(mapping)) {
        if (!MAPPING_ADDON_KEYS.has(addonKey))
            continue;
        if (addonVal === null || typeof addonVal === "string" || typeof addonVal === "number" || typeof addonVal === "boolean") {
            if (!(0, schema_1.isSecretKey)(addonKey))
                out[addonKey] = addonVal;
            continue;
        }
        if (!addonVal || typeof addonVal !== "object" || Array.isArray(addonVal))
            continue;
        const sub = {};
        for (const [k, v] of Object.entries(addonVal)) {
            if ((0, schema_1.isSecretKey)(k))
                continue;
            if (!MAPPING_SUBKEY_RE.test(k) && !isAllowedConfigKey(k))
                continue;
            if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
                sub[k] = v;
            }
        }
        if (Object.keys(sub).length > 0)
            out[addonKey] = sub;
    }
    return out;
}
function collectAdapterConfigExport(config) {
    const raw = config && typeof config === "object" ? config : {};
    const modes = (0, execution_mode_1.executionModesFromConfig)(raw);
    return {
        allowed_native: filterAllowlistedConfig(raw),
        configured_modes_at_export: {
            global: modes.global,
            wallbox: modes.wallbox,
            battery: modes.battery,
            immersion_heater: modes.immersion_heater,
            air_conditioning: modes.air_conditioning,
        },
        restore_policy: {
            apply_as: "dryrun",
        },
    };
}
exports.collectAdapterConfigExport = collectAdapterConfigExport;
function collectMappingsExport(config) {
    const raw = config && typeof config === "object" ? config : {};
    const mapping = raw.mapping && typeof raw.mapping === "object" ? raw.mapping : {};
    const out = {};
    const flatKeys = Object.keys(raw).filter((k) => (k.endsWith("_target") || k.endsWith("_enabled") || k.endsWith("_state")) &&
        isAllowedConfigKey(k) &&
        !(0, schema_1.isSecretKey)(k));
    for (const k of flatKeys) {
        out[k] = raw[k];
    }
    const filteredMapping = filterMappingObject(mapping);
    if (Object.keys(filteredMapping).length > 0) {
        out.mapping = filteredMapping;
    }
    return out;
}
exports.collectMappingsExport = collectMappingsExport;
function filterVehicleProfileRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row))
        return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        if (!exports.VEHICLE_PROFILE_ALLOWED_KEYS.has(k) || (0, schema_1.isSecretKey)(k))
            continue;
        if (v !== undefined && v !== null && typeof v === "object")
            continue;
        out[k] = v;
    }
    return out;
}
exports.filterVehicleProfileRow = filterVehicleProfileRow;
function collectVehicleProfilesExport(config) {
    const raw = config && typeof config === "object" ? config : {};
    const profiles = Array.isArray(raw.wb_vehicle_profiles) ? raw.wb_vehicle_profiles : [];
    return { profiles: profiles.map((row) => filterVehicleProfileRow(row)) };
}
exports.collectVehicleProfilesExport = collectVehicleProfilesExport;
function collectPoliciesExport(config) {
    const raw = config && typeof config === "object" ? config : {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("policy_") || k.startsWith("global_mode_") || k.startsWith("planner_")) {
            if (!(0, schema_1.isSecretKey)(k))
                out[k] = v;
        }
    }
    return out;
}
exports.collectPoliciesExport = collectPoliciesExport;

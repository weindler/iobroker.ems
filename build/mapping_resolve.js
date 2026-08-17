"use strict";
/**
 * Mapping-Ziele aus der Adapterkonfiguration (jsonConfig) — keine ioBroker-Spiegelstates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostAdapterConfig = exports.resolveMappingTargetFromConfig = exports.mappingTableFromConfig = void 0;
const mapping_config_1 = require("./addons/air_conditioning/mapping_config");
const mapping_1 = require("./addons/battery/mapping");
const mapping_config_2 = require("./addons/dynamic_tariff/mapping_config");
const mapping_config_3 = require("./addons/immersion_heater/mapping_config");
const mapping_config_4 = require("./mapping_config");
function asConfig(config) {
    return config && typeof config === "object" ? config : {};
}
function mappingTableFromConfig(config, addonId) {
    const cfg = asConfig(config);
    switch (addonId) {
        case "wallbox":
            return (0, mapping_config_4.wallboxMappingFromConfig)(cfg);
        case "battery":
            return (0, mapping_1.batteryMappingNativeFromConfig)(cfg);
        case "immersion_heater":
            return (0, mapping_config_3.immersionHeaterMappingFromConfig)(cfg);
        case "air_conditioning":
            return (0, mapping_config_1.acMappingFromConfig)(cfg);
        case "dynamic_tariff":
            return (0, mapping_config_2.dynamicTariffMappingFromConfig)(cfg);
        default:
            return {};
    }
}
exports.mappingTableFromConfig = mappingTableFromConfig;
function resolveMappingTargetFromConfig(config, addonId, role) {
    const entry = mappingTableFromConfig(config, addonId)[role];
    if (!entry) {
        return null;
    }
    const targetState = typeof entry.target_state === "string" ? entry.target_state.trim() : "";
    if (!targetState) {
        return null;
    }
    const allowed = typeof entry.allowed_values === "string" && entry.allowed_values.trim() ? entry.allowed_values.trim() : null;
    return {
        enabled: entry.enabled !== false,
        targetState,
        allowedValues: allowed,
    };
}
exports.resolveMappingTargetFromConfig = resolveMappingTargetFromConfig;
function hostAdapterConfig(host) {
    return host.config;
}
exports.hostAdapterConfig = hostAdapterConfig;

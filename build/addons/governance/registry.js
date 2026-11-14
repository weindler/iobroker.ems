"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOVERNED_ADDON_REGISTRY = void 0;
exports.governedAddonEntry = governedAddonEntry;
exports.governedAddonByRuntimeId = governedAddonByRuntimeId;
exports.isGovernedAddonId = isGovernedAddonId;
exports.governedAddonIds = governedAddonIds;
exports.GOVERNED_ADDON_REGISTRY = [
    {
        id: "wallbox",
        displayNameDe: "Wallbox",
        displayNameEn: "Wallbox",
        enabledConfigKey: "wallbox_enabled",
        aiAllowedConfigKey: "wallbox_ai_optimization_allowed",
        runtimeAddonId: "wallbox",
    },
    {
        id: "immersion_heater",
        displayNameDe: "Heizstab",
        displayNameEn: "Immersion heater",
        enabledConfigKey: "immersion_heater_enabled",
        aiAllowedConfigKey: "immersion_heater_ai_optimization_allowed",
        runtimeAddonId: "immersion_heater",
    },
    {
        id: "battery",
        displayNameDe: "Batterie",
        displayNameEn: "Battery",
        enabledConfigKey: "battery_enabled",
        aiAllowedConfigKey: "battery_ai_optimization_allowed",
        runtimeAddonId: "battery",
    },
    {
        id: "climate",
        displayNameDe: "Klimaanlage",
        displayNameEn: "Air conditioning",
        enabledConfigKey: "climate_enabled",
        aiAllowedConfigKey: "climate_ai_optimization_allowed",
        runtimeAddonId: "air_conditioning",
    },
];
const BY_ID = new Map(exports.GOVERNED_ADDON_REGISTRY.map((e) => [e.id, e]));
const BY_RUNTIME_ID = new Map(exports.GOVERNED_ADDON_REGISTRY.map((e) => [e.runtimeAddonId, e]));
function governedAddonEntry(id) {
    const entry = BY_ID.get(id);
    if (!entry) {
        throw new Error(`unknown governed addon: ${id}`);
    }
    return entry;
}
function governedAddonByRuntimeId(runtimeAddonId) {
    return BY_RUNTIME_ID.get(runtimeAddonId) ?? null;
}
function isGovernedAddonId(id) {
    return BY_ID.has(id);
}
function governedAddonIds() {
    return exports.GOVERNED_ADDON_REGISTRY.map((e) => e.id);
}

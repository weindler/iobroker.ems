"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGovernedAddonId = exports.getAddonGovernance = exports.isAddonAiOptimizationAllowed = exports.isAddonEnabled = exports.boolField = void 0;
const registry_1 = require("./registry");
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function boolField(config, key, defaultVal) {
    const v = config[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["1", "true", "on", "yes", "ja"].includes(s))
            return true;
        if (["0", "false", "off", "no", "nein"].includes(s))
            return false;
    }
    return defaultVal;
}
exports.boolField = boolField;
/** Default true — preserves prior runtime default (addons.*.enabled def true). */
const DEFAULT_ADDON_ENABLED = true;
const DEFAULT_AI_ALLOWED = false;
function isAddonEnabled(config, addonId) {
    const entry = (0, registry_1.governedAddonEntry)(addonId);
    return boolField(configRecord(config), entry.enabledConfigKey, DEFAULT_ADDON_ENABLED);
}
exports.isAddonEnabled = isAddonEnabled;
function isAddonAiOptimizationAllowed(config, addonId) {
    const entry = (0, registry_1.governedAddonEntry)(addonId);
    return boolField(configRecord(config), entry.aiAllowedConfigKey, DEFAULT_AI_ALLOWED);
}
exports.isAddonAiOptimizationAllowed = isAddonAiOptimizationAllowed;
function getAddonGovernance(config, addonId) {
    return {
        enabled: isAddonEnabled(config, addonId),
        aiOptimizationAllowed: isAddonAiOptimizationAllowed(config, addonId),
    };
}
exports.getAddonGovernance = getAddonGovernance;
function resolveGovernedAddonId(addonOrRuntimeId) {
    if ((0, registry_1.isGovernedAddonId)(addonOrRuntimeId)) {
        return addonOrRuntimeId;
    }
    const entry = (0, registry_1.governedAddonByRuntimeId)(addonOrRuntimeId);
    return entry?.id ?? null;
}
exports.resolveGovernedAddonId = resolveGovernedAddonId;

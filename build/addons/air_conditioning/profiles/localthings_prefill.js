"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeLocalthingsPrefillIntoConfig = exports.buildLocalthingsPrefillPatch = void 0;
const constants_1 = require("../constants");
const registry_1 = require("./registry");
const localthings_presets_1 = require("./localthings_presets");
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function readTarget(c, unitIndex, role) {
    const v = c[`${(0, constants_1.acMappingFlatPrefix)(unitIndex, role)}_target`];
    return typeof v === "string" ? v.trim() : "";
}
function readProfile(c, unitIndex) {
    const def = String(c.ac_default_profile ?? "samsung_smartthings").trim();
    const raw = c[`ac_u${unitIndex}_profile`];
    const s = typeof raw === "string" && raw.trim() ? raw.trim() : def;
    return s;
}
function unitHasHassMappings(c, unitIndex) {
    const roles = [
        "feedback_switch",
        "cmd_switch_on",
        "cmd_set_mode",
        "cmd_set_cool_setpoint",
    ];
    return roles.some((r) => (0, localthings_presets_1.isHassLocalthingsTarget)(readTarget(c, unitIndex, r)));
}
function unitNeedsLocalthingsPrefill(c, unitIndex) {
    if (!(0, registry_1.isLocalthingsHassProfile)(readProfile(c, unitIndex)))
        return false;
    if (unitHasHassMappings(c, unitIndex))
        return false;
    const on = readTarget(c, unitIndex, "cmd_switch_on");
    const fb = readTarget(c, unitIndex, "feedback_switch");
    if (!on && !fb)
        return true;
    // Noch SmartThings-Pfade nach Profilwechsel → Prefill erlaubt
    return (0, localthings_presets_1.isSmartThingsTarget)(on) || (0, localthings_presets_1.isSmartThingsTarget)(fb);
}
function applyMappingPatch(patch, unitIndex, mappings, onlyEmptyOrSmartthings, c) {
    for (const [role, target] of Object.entries(mappings)) {
        if (!target)
            continue;
        const key = `${(0, constants_1.acMappingFlatPrefix)(unitIndex, role)}_target`;
        const enKey = `${(0, constants_1.acMappingFlatPrefix)(unitIndex, role)}_enabled`;
        const existing = readTarget(c, unitIndex, role);
        if (onlyEmptyOrSmartthings) {
            if (existing && (0, localthings_presets_1.isHassLocalthingsTarget)(existing))
                continue;
            if (existing && !(0, localthings_presets_1.isSmartThingsTarget)(existing) && existing.length > 0)
                continue;
        }
        patch[key] = target;
        patch[enKey] = true;
    }
}
/**
 * Prefill für LocalThings: nur wenn Profil LocalThings und keine HASS-Mappings.
 * Überschreibt keine vorhandenen hass.* User-Mappings.
 * Site-Presets für bekannte Units; sonst Ableitung aus Climate-Basis falls gesetzt.
 */
function buildLocalthingsPrefillPatch(config) {
    const c = configRecord(config);
    const patch = {};
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        if (!unitNeedsLocalthingsPrefill(c, i))
            continue;
        const preset = localthings_presets_1.LOCALTHINGS_SITE_PRESETS.find((p) => p.unitIndex === i);
        if (preset) {
            applyMappingPatch(patch, i, preset.mappings, true, c);
            continue;
        }
        const climateHint = readTarget(c, i, "feedback_mode") ||
            readTarget(c, i, "feedback_switch") ||
            readTarget(c, i, "cmd_switch_on");
        const derived = (0, localthings_presets_1.deriveLocalthingsMappingsFromClimateBase)(climateHint);
        if (Object.keys(derived).length > 0) {
            applyMappingPatch(patch, i, derived, true, c);
        }
    }
    return Object.keys(patch).length > 0 ? patch : null;
}
exports.buildLocalthingsPrefillPatch = buildLocalthingsPrefillPatch;
function mergeLocalthingsPrefillIntoConfig(config) {
    const c = { ...configRecord(config) };
    const patch = buildLocalthingsPrefillPatch(c);
    if (!patch)
        return c;
    return { ...c, ...patch };
}
exports.mergeLocalthingsPrefillIntoConfig = mergeLocalthingsPrefillIntoConfig;

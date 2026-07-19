"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acMappingCommandsForConfiguredUnits = exports.isAcMappingRoleConfigured = exports.configuredAcUnitIndexes = exports.isAcUnitConfigured = exports.acUnitHasMappingTarget = void 0;
/**
 * When an AC unit slot gets state-tree objects.
 * Slots 1..AC_UNIT_COUNT remain Admin UI capacity — only enabled units get objects.
 */
const constants_1 = require("./constants");
const config_1 = require("./config");
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
/** True if any mapping role has a non-empty target_state in native config. */
function acUnitHasMappingTarget(config, index) {
    const c = configRecord(config);
    for (const role of constants_1.AC_MAPPING_ROLES) {
        const t = c[`${(0, constants_1.acMappingFlatPrefix)(index, role)}_target`];
        if (typeof t === "string" && t.trim().length > 0) {
            return true;
        }
    }
    return false;
}
exports.acUnitHasMappingTarget = acUnitHasMappingTarget;
/**
 * Configured for ensure/cleanup = Unit in Admin aktiviert (`ac_uN_enabled`).
 * Nur aktivierte Units bekommen Runtime-/Mapping-States.
 */
function isAcUnitConfigured(config, index) {
    if (!Number.isInteger(index) || index < 1 || index > constants_1.AC_UNIT_COUNT) {
        return false;
    }
    return (0, config_1.acUnitConfigFromAdapter)(config, index).enabled === true;
}
exports.isAcUnitConfigured = isAcUnitConfigured;
function configuredAcUnitIndexes(config) {
    const out = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        if (isAcUnitConfigured(config, i)) {
            out.push(i);
        }
    }
    return out;
}
exports.configuredAcUnitIndexes = configuredAcUnitIndexes;
/** True if this unit+role has target or explicit enabled in native config. */
function isAcMappingRoleConfigured(config, index, role) {
    const c = configRecord(config);
    const prefix = (0, constants_1.acMappingFlatPrefix)(index, role);
    const t = c[`${prefix}_target`];
    const en = c[`${prefix}_enabled`];
    const hasTarget = typeof t === "string" && t.trim().length > 0;
    const hasEnabled = typeof en === "boolean";
    return hasTarget || hasEnabled;
}
exports.isAcMappingRoleConfigured = isAcMappingRoleConfigured;
/**
 * Mapping commands for ensure/cleanup: enabled units × roles that are actually mapped in Admin.
 * Empty slots do not get mapping leaves (lightweight surface).
 */
function acMappingCommandsForConfiguredUnits(config) {
    const cmds = [];
    for (const i of configuredAcUnitIndexes(config)) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            if (isAcMappingRoleConfigured(config, i, role)) {
                cmds.push((0, constants_1.acUnitMappingCommand)(i, role));
            }
        }
    }
    return cmds;
}
exports.acMappingCommandsForConfiguredUnits = acMappingCommandsForConfiguredUnits;

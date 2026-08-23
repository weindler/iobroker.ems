"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localthingsMappingsValid = exports.validateAcUnitMappings = void 0;
const registry_1 = require("./registry");
const LOCALTHINGS_REQUIRED = [
    "feedback_switch",
    "cmd_switch_on",
    "cmd_switch_off",
    "cmd_set_cool_setpoint",
    "cmd_set_mode",
    "room_temp",
];
function targetOf(targets, role) {
    return (targets[role] ?? "").trim();
}
/**
 * Profilabhängige Mapping-Validierung (kein Startabbruch — Issues für Admin/Diagnose).
 * LocalThings: kein Refresh-Pflichtfeld; Write-States dürfen write-only sein.
 */
function validateAcUnitMappings(input) {
    const issues = [];
    const { unitIndex, profileId, targets } = input;
    if (!(0, registry_1.isLocalthingsHassProfile)(profileId)) {
        return issues;
    }
    for (const role of LOCALTHINGS_REQUIRED) {
        if (!targetOf(targets, role)) {
            issues.push({
                unitIndex,
                role,
                severity: "error",
                messageDe: `LocalThings: Pflicht-Mapping fehlt (${role}).`,
            });
        }
    }
    const refresh = targetOf(targets, "cmd_refresh");
    if (refresh) {
        issues.push({
            unitIndex,
            role: "cmd_refresh",
            severity: "warning",
            messageDe: "LocalThings: Refresh-Mapping ist unnötig (lokal über HASS) — kein Fehler.",
        });
    }
    return issues;
}
exports.validateAcUnitMappings = validateAcUnitMappings;
function localthingsMappingsValid(profileId, targets) {
    return validateAcUnitMappings({ unitIndex: 1, profileId, targets }).every((i) => i.severity !== "error");
}
exports.localthingsMappingsValid = localthingsMappingsValid;

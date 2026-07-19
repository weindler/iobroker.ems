"use strict";
/**
 * Allowlist for controlled dynamic placeholder + lean planner surface cleanup.
 * Only relative IDs matching these patterns may be deleted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANUP_ALLOWLIST_DESCRIPTION = exports.isAllowlistedCleanupRelativeId = exports.isLeanPlannerPurgeRoot = exports.LEAN_PLANNER_PURGE_ROOTS = exports.COMPATIBILITY_STATE_PREFIXES = exports.PROTECTED_PREFIXES = void 0;
/** Never delete these families (core intent / learning mirrors / modes). */
exports.PROTECTED_PREFIXES = [
    "planner.intent.supply",
    "learning.persistence",
    "global.execution_mode",
    "userdata",
    "alias",
];
/** Compatibility JSON mirrors that stay until an explicit reader migration (4E/4F). */
exports.COMPATIBILITY_STATE_PREFIXES = [
    "learning.persistence.",
];
/**
 * Planner Shadow / operator-plan mirrors purged while production forces planner off.
 * Exact channel/root ids only — recursive delete removes children.
 */
exports.LEAN_PLANNER_PURGE_ROOTS = [
    "planner.authority",
    "planner.takeover",
    "planner.coordinator",
    "planner.intent.forecast_plan",
    "planner.intent.daily_plan",
    "planner.intent.contributions",
    "planner.intent.allocation",
];
const AC_UNIT_RE = /^addons\.air_conditioning\.units\.unit_[1-5]$/;
const AC_MAPPING_RE = /^addons\.air_conditioning\.mapping\.unit_[1-5]_[a-z0-9_]+$/;
const VEHICLE_FOLDER_RE = /^addons\.wallbox\.vehicles\.[a-z0-9_]+$/;
function isLeanPlannerPurgeRoot(relativeId) {
    return exports.LEAN_PLANNER_PURGE_ROOTS.includes(relativeId);
}
exports.isLeanPlannerPurgeRoot = isLeanPlannerPurgeRoot;
function isAllowlistedCleanupRelativeId(relativeId) {
    if (!relativeId || relativeId.includes("..") || relativeId.startsWith(".") || relativeId.includes("/")) {
        return false;
    }
    if (relativeId.startsWith("ems.") || relativeId.includes(":")) {
        return false;
    }
    if (isLeanPlannerPurgeRoot(relativeId)) {
        return true;
    }
    return AC_UNIT_RE.test(relativeId) || AC_MAPPING_RE.test(relativeId) || VEHICLE_FOLDER_RE.test(relativeId);
}
exports.isAllowlistedCleanupRelativeId = isAllowlistedCleanupRelativeId;
exports.CLEANUP_ALLOWLIST_DESCRIPTION = [
    "addons.air_conditioning.units.unit_{1-5} (only when unit not configured)",
    "addons.air_conditioning.mapping.unit_{1-5}_* (only when unit not configured)",
    "addons.wallbox.vehicles.<vehicleId> (only when vehicle_id absent from wb_vehicle_profiles)",
    ...exports.LEAN_PLANNER_PURGE_ROOTS.map((r) => `${r} (lean planner surface purge)`),
];

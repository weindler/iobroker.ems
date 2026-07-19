"use strict";
/**
 * Allowlist for Phase 4B1 dynamic placeholder cleanup.
 * Only relative IDs matching these patterns may be deleted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANUP_ALLOWLIST_DESCRIPTION = exports.isAllowlistedCleanupRelativeId = exports.COMPATIBILITY_STATE_PREFIXES = exports.PROTECTED_PREFIXES = void 0;
/** Never delete these families (compatibility / authority / learning mirrors). */
exports.PROTECTED_PREFIXES = [
    "planner.intent",
    "planner.authority",
    "planner.takeover",
    "planner.coordinator",
    "learning.persistence",
    "global.execution_mode",
    "userdata",
    "alias",
];
exports.COMPATIBILITY_STATE_PREFIXES = [
    "planner.intent.allocation.",
    "planner.intent.",
    "learning.persistence.",
];
const AC_UNIT_RE = /^addons\.air_conditioning\.units\.unit_[1-5]$/;
const AC_MAPPING_RE = /^addons\.air_conditioning\.mapping\.unit_[1-5]_[a-z0-9_]+$/;
const VEHICLE_FOLDER_RE = /^addons\.wallbox\.vehicles\.[a-z0-9_]+$/;
function isAllowlistedCleanupRelativeId(relativeId) {
    if (!relativeId || relativeId.includes("..") || relativeId.startsWith(".") || relativeId.includes("/")) {
        return false;
    }
    if (relativeId.startsWith("ems.") || relativeId.includes(":")) {
        // Absolute / foreign ids are never allowlisted here (adapter uses relative ids).
        return false;
    }
    return AC_UNIT_RE.test(relativeId) || AC_MAPPING_RE.test(relativeId) || VEHICLE_FOLDER_RE.test(relativeId);
}
exports.isAllowlistedCleanupRelativeId = isAllowlistedCleanupRelativeId;
exports.CLEANUP_ALLOWLIST_DESCRIPTION = [
    "addons.air_conditioning.units.unit_{1-5} (only when unit not configured)",
    "addons.air_conditioning.mapping.unit_{1-5}_* (only when unit not configured)",
    "addons.wallbox.vehicles.<vehicleId> (only when vehicle_id absent from wb_vehicle_profiles)",
];

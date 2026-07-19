/**
 * Allowlist for controlled dynamic placeholder + lean planner surface cleanup.
 * Only relative IDs matching these patterns may be deleted.
 */

/** Never delete these families (core intent / learning mirrors / modes). */
export const PROTECTED_PREFIXES = [
	"planner.intent.supply",
	"learning.persistence",
	"global.execution_mode",
	"userdata",
	"alias",
] as const;

/** Compatibility JSON mirrors that stay until an explicit reader migration (4E/4F). */
export const COMPATIBILITY_STATE_PREFIXES = [
	"learning.persistence.",
] as const;

/**
 * Planner Shadow / operator-plan mirrors purged while production forces planner off.
 * Exact channel/root ids only — recursive delete removes children.
 */
export const LEAN_PLANNER_PURGE_ROOTS = [
	"planner.authority",
	"planner.takeover",
	"planner.coordinator",
	"planner.intent.forecast_plan",
	"planner.intent.daily_plan",
	"planner.intent.contributions",
	"planner.intent.allocation",
] as const;

const AC_UNIT_RE = /^addons\.air_conditioning\.units\.unit_[1-5]$/;
const AC_MAPPING_RE = /^addons\.air_conditioning\.mapping\.unit_[1-5]_[a-z0-9_]+$/;
const VEHICLE_FOLDER_RE = /^addons\.wallbox\.vehicles\.[a-z0-9_]+$/;

export function isLeanPlannerPurgeRoot(relativeId: string): boolean {
	return (LEAN_PLANNER_PURGE_ROOTS as readonly string[]).includes(relativeId);
}

export function isAllowlistedCleanupRelativeId(relativeId: string): boolean {
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

export const CLEANUP_ALLOWLIST_DESCRIPTION = [
	"addons.air_conditioning.units.unit_{1-5} (only when unit not configured)",
	"addons.air_conditioning.mapping.unit_{1-5}_* (only when unit not configured)",
	"addons.wallbox.vehicles.<vehicleId> (only when vehicle_id absent from wb_vehicle_profiles)",
	...LEAN_PLANNER_PURGE_ROOTS.map((r) => `${r} (lean planner surface purge)`),
] as const;

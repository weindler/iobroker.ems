/**
 * Allowlist for controlled dynamic placeholder + lean planner surface cleanup.
 * Only relative IDs matching these patterns may be deleted.
 */

/** Never delete these families (core intent / learning status / modes). */
export const PROTECTED_PREFIXES = [
	"planner.intent.supply",
	"learning.persistence.last_mirror",
	"learning.persistence.last_restore",
	"learning.persistence.files_present",
	"global.execution_mode",
	"userdata",
	"alias",
] as const;

/** Compatibility: learning.persistence.*_json may be purged (RAM diet); restore from .emsbackup files. */
export const COMPATIBILITY_STATE_PREFIXES = [] as const;

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

/** Large learning JSON mirrors — replaced by file-backed .emsbackup. */
export const LEARNING_MIRROR_PURGE_RE =
	/^learning\.persistence\.(battery_runtime|house_load|thermal_runtime|price_learning|price_forecast|pv_bias_daily|power_hourly|energy_daily)_json$/;

/** Battery-runtime power diagnostics (lean KPI surface). */
export const BATTERY_RUNTIME_DIAG_PURGE_RE =
	/^learning\.battery_runtime\.power_(history_raw_rows|history_normalized_rows|raw_charge_samples|raw_discharge_samples|hourly_charge_points|hourly_discharge_points|invert_applied|invert_auto)$/;

/** Stub addon folders without full runtime (basis no longer ensured). */
export const STUB_ADDON_PURGE_RE =
	/^addons\.(sensorics|inverter_[123]|pv_plant|house_main_fuse|heating|heat_pump|consumer_1|weather_live|weather_forecast|pv_forecast|series_storage|fixed_tariff)(\.|$)/;

const AC_UNIT_RE = /^addons\.air_conditioning\.units\.unit_[1-5]$/;
/** Mapping command channel or known leaf under it. */
const AC_MAPPING_RE =
	/^addons\.air_conditioning\.mapping\.unit_[1-5]_[a-z0-9_]+(\.(enabled|target_state|allowed_values))?$/;
const VEHICLE_FOLDER_RE = /^addons\.wallbox\.vehicles\.[a-z0-9_]+$/;
const PLANNER_OPTIONAL_INTENT_RE =
	/^planner\.intent\.(thermal|cooling|battery\.winter)(\.|$)/;
/** Any mapping allowed_values leaf (diet — recreate only when native has values). */
const MAPPING_ALLOWED_VALUES_RE = /^addons\.[a-z0-9_]+\.mapping\.[a-z0-9_]+\.allowed_values$/;
/** Stub addon basis leaves without channel root. */
const STUB_ADDON_LEAF_RE =
	/^addons\.(sensorics|inverter_[123]|pv_plant|house_main_fuse|heating|heat_pump|consumer_1|weather_live|weather_forecast|pv_forecast|series_storage|fixed_tariff)\.(enabled|available|mode)$/;

export const AC_MAPPING_LEAF_SUFFIXES = ["enabled", "target_state", "allowed_values"] as const;

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
	if (LEARNING_MIRROR_PURGE_RE.test(relativeId)) {
		return true;
	}
	if (BATTERY_RUNTIME_DIAG_PURGE_RE.test(relativeId)) {
		return true;
	}
	if (STUB_ADDON_PURGE_RE.test(relativeId)) {
		return true;
	}
	if (PLANNER_OPTIONAL_INTENT_RE.test(relativeId)) {
		return true;
	}
	if (MAPPING_ALLOWED_VALUES_RE.test(relativeId)) {
		return true;
	}
	if (STUB_ADDON_LEAF_RE.test(relativeId)) {
		return true;
	}
	if (relativeId === "info.backup" || relativeId.startsWith("info.backup.")) {
		return true;
	}
	return AC_UNIT_RE.test(relativeId) || AC_MAPPING_RE.test(relativeId) || VEHICLE_FOLDER_RE.test(relativeId);
}

export const CLEANUP_ALLOWLIST_DESCRIPTION = [
	"addons.air_conditioning.units.unit_{1-5} (only when unit not enabled)",
	"addons.air_conditioning.mapping.unit_{1-5}_* (+ .enabled/.target_state/.allowed_values)",
	"addons.wallbox.vehicles.<vehicleId> (only when vehicle_id absent from wb_vehicle_profiles)",
	"learning.persistence.*_json (large mirrors → .emsbackup files)",
	"learning.battery_runtime.power_* diagnostics",
	"stub addons.* (inverter/heating/… without runtime)",
	"planner.intent.thermal|cooling|battery.winter when addon/winter disabled",
	"info.backup.* (merged into backup.*)",
	...LEAN_PLANNER_PURGE_ROOTS.map((r) => `${r} (lean planner surface purge)`),
] as const;

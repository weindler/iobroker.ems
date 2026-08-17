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
 * Planner Shadow / Takeover / Authority only — purged while production forces Shadow off.
 * Forecast Plan, Daily Plan and Allocation are the live control path and must stay.
 */
export const LEAN_PLANNER_PURGE_ROOTS = [
	"planner.authority",
	"planner.takeover",
	"planner.coordinator",
] as const;

/** Large learning JSON mirrors — replaced by file-backed .emsbackup. */
export const LEARNING_MIRROR_PURGE_RE =
	/^learning\.persistence\.(battery_runtime|house_load|thermal_runtime|thermal_boiler|price_learning|price_forecast|pv_bias_daily|power_hourly|energy_daily)_json$/;

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
/** Legacy Realtime-Intent-Bäume + surplus/deficit (Block 5 — immer purge). */
const PLANNER_LEGACY_INTENT_RE =
	/^planner\.intent\.(thermal|cooling|battery\.winter)(\.|$)/;
const PLANNER_LEGACY_SURPLUS_RE = /^planner\.(surplus_w|deficit_w)$/;
/** Any mapping allowed_values leaf (diet — recreate only when native has values). */
const MAPPING_ALLOWED_VALUES_RE = /^addons\.[a-z0-9_]+\.mapping\.[a-z0-9_]+\.allowed_values$/;
/** Stub addon basis leaves without channel root. */
const STUB_ADDON_LEAF_RE =
	/^addons\.(sensorics|inverter_[123]|pv_plant|house_main_fuse|heating|heat_pump|consumer_1|weather_live|weather_forecast|pv_forecast|series_storage|fixed_tariff)\.(enabled|available|mode)$/;

/** Wallbox deep contract/feedback leaves → detail_json + support bundle. */
const WALLBOX_RUNTIME_BALLAST_RE =
	/^addons\.wallbox\.runtime\.(charge_boost_active|dispatch_intent_json|dispatch_target_json|dryrun_command_json|command_candidate_json|command_candidate_present|live_foundation_phase|live_write_released|write_plan_present|write_plan_json|write_contract_ready|feedback_contract_ready|write_operation_count|write_control_model|write_evcc_path_confirmed|write_scenario|write_control_path_reason|legacy_mappings_present|evcc_control_mappings_present|control_mapping_diagnostics_json|feedback_contract_present|feedback_contract_json|feedback_required|feedback_contract_structural_ready|feedback_issue_kind|feedback_expectation_count|feedback_matched_count|feedback_mismatch_count|feedback_unavailable_count|feedback_invalid_count|feedback_settle_time_ms|feedback_timeout_ms|active_vehicle_snapshot_json)$/;

/** User-intent source/diag mirrors — Betrieb keeps domain resolved_* + request_json. */
const USER_INTENT_BALLAST_RE =
	/^user_intent\.(resolved_all_json|wallbox\.diagnostics(\.|$)|wallbox\.sources(\.|$)|thermal\.diagnostics(\.|$)|battery\.diagnostics(\.|$))/;

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
	if (PLANNER_LEGACY_INTENT_RE.test(relativeId) || PLANNER_LEGACY_SURPLUS_RE.test(relativeId)) {
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
	if (WALLBOX_RUNTIME_BALLAST_RE.test(relativeId)) {
		return true;
	}
	if (USER_INTENT_BALLAST_RE.test(relativeId)) {
		return true;
	}
	return AC_UNIT_RE.test(relativeId) || AC_MAPPING_RE.test(relativeId) || VEHICLE_FOLDER_RE.test(relativeId);
}

export const CLEANUP_ALLOWLIST_DESCRIPTION = [
	"addons.air_conditioning.units.unit_{1-5} (only when unit not enabled)",
	"addons.air_conditioning.mapping.unit_{1-5}_* (+ .enabled/.target_state/.allowed_values)",
	"addons.wallbox.vehicles.<vehicleId> (always — fat profiles removed in v0.1.227)",
	"learning.persistence.*_json (large mirrors → .emsbackup files)",
	"learning.battery_runtime.power_* diagnostics",
	"stub addons.* (inverter/heating/… without runtime)",
	"planner.intent.thermal|cooling|battery.winter + planner.surplus_w|deficit_w (Block 5 legacy purge)",
	"info.backup.* (merged into backup.*)",
	"addons.wallbox.runtime.* ballast (→ detail_json / support)",
	"user_intent sources/diagnostics ballast (Betrieb: resolved_* + request_json)",
	...LEAN_PLANNER_PURGE_ROOTS.map((r) => `${r} (lean shadow surface purge)`),
] as const;

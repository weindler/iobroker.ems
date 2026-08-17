"use strict";
/**
 * Allowlist for controlled dynamic placeholder + lean planner surface cleanup.
 * Only relative IDs matching these patterns may be deleted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANUP_ALLOWLIST_DESCRIPTION = exports.isAllowlistedCleanupRelativeId = exports.isLeanPlannerPurgeRoot = exports.AC_MAPPING_LEAF_SUFFIXES = exports.STUB_ADDON_PURGE_RE = exports.BATTERY_RUNTIME_DIAG_PURGE_RE = exports.LEARNING_MIRROR_PURGE_RE = exports.LEAN_PLANNER_PURGE_ROOTS = exports.COMPATIBILITY_STATE_PREFIXES = exports.PROTECTED_PREFIXES = void 0;
/** Never delete these families (core intent / learning status / modes). */
exports.PROTECTED_PREFIXES = [
    "planner.intent.supply",
    "learning.persistence.last_mirror",
    "learning.persistence.last_restore",
    "learning.persistence.files_present",
    "global.execution_mode",
    "userdata",
    "alias",
];
/** Compatibility: learning.persistence.*_json may be purged (RAM diet); restore from .emsbackup files. */
exports.COMPATIBILITY_STATE_PREFIXES = [];
/**
 * Planner Shadow / Takeover / Authority only — purged while production forces Shadow off.
 * Forecast Plan, Daily Plan and Allocation are the live control path and must stay.
 */
exports.LEAN_PLANNER_PURGE_ROOTS = [
    "planner.authority",
    "planner.takeover",
    "planner.coordinator",
];
/** Large learning JSON mirrors — replaced by file-backed .emsbackup. */
exports.LEARNING_MIRROR_PURGE_RE = /^learning\.persistence\.(battery_runtime|house_load|thermal_runtime|thermal_boiler|price_learning|price_forecast|pv_bias_daily|power_hourly|energy_daily)_json$/;
/** Battery-runtime power diagnostics (lean KPI surface). */
exports.BATTERY_RUNTIME_DIAG_PURGE_RE = /^learning\.battery_runtime\.(power_(history_raw_rows|history_normalized_rows|raw_charge_samples|raw_discharge_samples|hourly_charge_points|hourly_discharge_points|invert_applied|invert_auto)|avg_charge_rate_pct_h|avg_discharge_rate_pct_h|max_discharge_power_w|seconds_since_full_charge|full_charge_source|topoff_interval_days|power_history_mode)$/;
/** Stub addon folders without full runtime (basis no longer ensured). */
exports.STUB_ADDON_PURGE_RE = /^addons\.(sensorics|inverter_[123]|pv_plant|house_main_fuse|heating|heat_pump|consumer_1|weather_live|weather_forecast|pv_forecast|series_storage|fixed_tariff)(\.|$)/;
const AC_UNIT_RE = /^addons\.air_conditioning\.units\.unit_[1-5]$/;
/** Mapping command channel or known leaf under it. */
const AC_MAPPING_RE = /^addons\.air_conditioning\.mapping\.unit_[1-5]_[a-z0-9_]+(\.(enabled|target_state|allowed_values))?$/;
const VEHICLE_FOLDER_RE = /^addons\.wallbox\.vehicles\.[a-z0-9_]+$/;
/** Legacy Realtime-Intent-Bäume + surplus/deficit (Block 5 — immer purge). */
const PLANNER_LEGACY_INTENT_RE = /^planner\.intent\.(thermal|cooling|battery\.winter)(\.|$)/;
const PLANNER_LEGACY_SURPLUS_RE = /^planner\.(surplus_w|deficit_w)$/;
/** Any mapping allowed_values leaf (diet — recreate only when native has values). */
const MAPPING_ALLOWED_VALUES_RE = /^addons\.[a-z0-9_]+\.mapping\.[a-z0-9_]+\.allowed_values$/;
/** Stub addon basis leaves without channel root. */
const STUB_ADDON_LEAF_RE = /^addons\.(sensorics|inverter_[123]|pv_plant|house_main_fuse|heating|heat_pump|consumer_1|weather_live|weather_forecast|pv_forecast|series_storage|fixed_tariff)\.(enabled|available|mode)$/;
/** Wallbox deep contract/feedback leaves → detail_json + support bundle. */
const WALLBOX_RUNTIME_KEEP = new Set([
    "decision_source",
    "reason_de",
    "daily_plan_status",
    "daily_plan_revision",
    "allocated_power_w",
    "energy_source",
    "write_allowed",
    "write_live_eligible",
    "execution_block_reason",
    "ownership_active",
    "fault_active",
    "fault_code",
    "fault_message",
    "fault_reset",
    "detail_json",
    "battery_hold_for_ev_charge",
    "battery_hold_reason_de",
    "external_vehicle_charge_active",
    "tibber_grid_rewards_active",
]);
function isWallboxRuntimeBallast(relativeId) {
    const prefix = "addons.wallbox.runtime.";
    if (!relativeId.startsWith(prefix))
        return false;
    const suffix = relativeId.slice(prefix.length);
    return suffix.length > 0 && !WALLBOX_RUNTIME_KEEP.has(suffix);
}
/** User-intent source/diag mirrors — Betrieb keeps domain resolved_* + request_json. */
const USER_INTENT_BALLAST_RE = /^user_intent\.(resolved_all_json|wallbox\.diagnostics(\.|$)|wallbox\.sources(\.|$)|thermal\.diagnostics(\.|$)|battery\.diagnostics(\.|$))/;
/** Mapping is native jsonConfig — no ioBroker mapping shadows. */
const ADDON_MAPPING_RE = /^addons\.[a-z0-9_]+\.mapping(\.|$)/;
const RUNTIME_SURFACE_RE = /^addons\.[a-z0-9_]+\.runtime\.surface(\.|$)/;
const FORECAST_PLAN_BALLAST_RE = /^planner\.intent\.forecast_plan\.(horizon_start|horizon_end|slot_minutes|active_contributors_json|excluded_contributors_json|days_json|slots_json|contributions_json|plan_json)$/;
const DAILY_PLAN_BALLAST_RE = /^planner\.intent\.daily_plan\.(global_mode|slot_minutes|active_contributions_json|excluded_contributions_json|slots_json|allocations_json|totals_json|unallocated_json|policy_snapshot_json|constraint_snapshot_json)$/;
const FLEXIBLE_CONTRIB_BALLAST_RE = /^planner\.intent\.contributions\.(flexible\.(generated_at|contributions_json|active_json|excluded_json)|battery(\.|$)|wallbox(\.|$))/;
const LEARNING_HISTORY_JSON_RE = /^learning\.(thermal_boiler|thermal_runtime)\.history_json$/;
const HOUSE_LOAD_MIRROR_JSON_RE = /^learning\.house_load\.(profile_json|health_json)$/;
const WEATHER_RAW_RE = /^learning\.weather\.horizon\.day[1-7]\.raw_(min|max)_temp_c$/;
const WEATHER_KPI_BALLAST_RE = /^learning\.weather\.(cloud_bias_pct|rain_bias_mm|wind_bias_kmh|valid_fields|missing_fields|quality_level|forecast_source|actual_source|summary_yesterday|sample_days_7d)$/;
const PRICE_FORECAST_BALLAST_RE = /^learning\.price_forecast\.(coverage_pct|missing_days|forecast_accuracy_90d|avg_error_ct_90d|freeze_time|today_freeze_time|tomorrow_freeze_time|actual_source|stability|forecast_source|freeze_reason|freeze_today_reason|frozen_target_date|frozen_today_target_date)$/;
const PRICE_LEARNING_BALLAST_RE = /^learning\.price_learning\.(cheap_hours|expensive_hours|avg_price_90d|volatility_30d|coverage_pct|missing_days|price_source)$/;
const HOUSE_LOAD_BALLAST_RE = /^learning\.house_load\.(current_segment|current_season|current_weekday|source_state|history_mode|sample_count)$/;
const THERMAL_BOILER_BALLAST_RE = /^learning\.thermal_boiler\.(next_run|trigger_source|history_points|cooling_asymptote_source|cooling_segments|vessel|hard_relevance|soft_relevance)$/;
const THERMAL_RUNTIME_BALLAST_RE = /^learning\.thermal_runtime\.(runtime_hours_median|cooling_asymptote_source|by_season_json|vessel|hard_relevance|soft_relevance)$/;
const USER_INTENT_MIRROR_BALLAST_RE = /^user_intent\.(wallbox|thermal|battery)\.(revision|last_changed|source_summary)$/;
const POLICY_BALLAST_RE = /^policy\.(system\.(schema_version|engine_version|registered_providers_json)|global\.provenance_json)$/;
const LIVE_WALLBOX_RE = /^live\.wallbox(\.|$)/;
const OPERATOR_NOTIFICATION_BALLAST_RE = /^operator\.notification\.(last_kind|last_dedup_key|candidates_json)$/;
const GLOBAL_MODES_BALLAST_RE = /^global_modes\.(available_json|issues_json)$/;
const IMMERSION_RUNTIME_BALLAST_RE = /^addons\.immersion_heater\.runtime\.(snapshot_json|planning_min_temp_c|forecast_target_temp_c|daily_plan_slot_start|daily_plan_slot_end|mandatory_allocated_power_w|flexible_allocated_power_w|minimum_runtime_remaining_sec|minimum_pause_remaining_sec|last_switch_at|daily_plan_revision|allocation_status)$/;
const PV_HORIZON_RAW_RE = /^learning\.pv_horizon\.(total_7d_raw_kwh|days_available|day[1-7]\.raw_kwh)$/;
const PV_BIAS_BALLAST_RE = /^learning\.pv_bias\.(freeze_time|frozen_source|freeze_reason|sample_days_7d)$/;
const WEATHER_HORIZON_BALLAST_RE = /^learning\.weather\.horizon\.days_available$/;
const BACKUP_BALLAST_RE = /^backup\.(last_kind|last_size_bytes|last_sha256|schema_version|restore\.(plan_expires_at|archive_sha256|transaction_id))$/;
const ECONOMICS_BALLAST_RE = /^economics\.(month|year)\.savings_eur$/;
const OPERATOR_STRATEGY_JSON_RE = /^operator\.plan\.strategy_json$/;
const BATTERY_LEARNING_BALLAST_RE = /^learning\.battery_runtime\.(avg_night_discharge_pct|avg_discharge_power_w)$/;
const PLANNER_LAST_JSON_RE = /^planner\.intent\.(last_json|last_reason_de|battery(\.|$))/;
const WALLBOX_STATUS_BALLAST_RE = /^addons\.wallbox\.status\.(charging_mode|charging_mode_label|vehicle_soc_pct)$/;
const WALLBOX_EVCC_BALLAST_RE = /^addons\.wallbox\.status\.evcc\.(snapshot_json|configured_phases|min_current_a|battery_discharge_control|connection|vehicle_range_km|vehicle_odometer_km|charge_remaining_duration_s|effective_max_current_a|effective_min_current_a|offered_current_a|charge_currents_json|charge_voltages_json|session_price|session_price_per_kwh|vehicle_detection_active|vehicle_title|smart_cost_limit|smart_cost_active)$/;
const WALLBOX_FOUNDATION_KEEP = new Set([
    "external_smart_plan_json",
    "external_min_soc_pct",
    "external_authority_state",
    "takeover_severity",
    "prepared_ev_state",
    "ev_execution_enabled",
    "ev_execution_authority",
    "ev_execution_ready",
    "ev_execution_block_reason",
    "ev_execution_desired_mode",
    "ev_execution_explain",
    "ev_execution_live_test_armed",
    "ev_execution_live_test_disarm",
    "ev_execution_live_test_consumed",
    "ev_execution_live_test_result",
    "ev_execution_live_test_block_reason",
]);
const BATTERY_KEEP_RE = /^addons\.battery\.(identity|telemetry|status\.(telemetry_ready|effective_execution_mode|state|reason|fault|lockout)|runtime\.(action|state|ownership_active|decision_source|reason_de|daily_plan_status|daily_plan_valid|daily_plan_revision|allocated_charge_power_w|energy_source|battery_setpoint_owner|battery_setpoint_kind|battery_setpoint_w)|diagnostics\.(fault_code|fault_reason)|grid_balance\.(enabled|active|ready|block_reason|current_price_ct_kwh|price_min_ct_kwh|price_allowed|grid_power_w|effective_power_w|hold_detected|ev_conflict|last_action|explain|live_test_armed|live_test_armed_at|live_test_result)|control\.fault_reset|failsafe\.)/;
const BATTERY_TREE_RE = /^addons\.battery\.(capabilities|limits|dryrun|status\.(profile|profile_loaded|control_ready|dryrun_ready|live_ready)|runtime\.|diagnostics\.|grid_balance\.)/;
function isWallboxFoundationBallast(relativeId) {
    const prefix = "addons.wallbox.status.ev_foundation.";
    if (!relativeId.startsWith(prefix))
        return false;
    const suffix = relativeId.slice(prefix.length);
    return suffix.length > 0 && !WALLBOX_FOUNDATION_KEEP.has(suffix);
}
function isBatteryBallast(relativeId) {
    if (!relativeId.startsWith("addons.battery."))
        return false;
    if (BATTERY_KEEP_RE.test(relativeId))
        return false;
    return BATTERY_TREE_RE.test(relativeId) || relativeId.startsWith("addons.battery.capabilities") || relativeId.startsWith("addons.battery.limits") || relativeId.startsWith("addons.battery.dryrun");
}
exports.AC_MAPPING_LEAF_SUFFIXES = ["enabled", "target_state", "allowed_values"];
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
    if (exports.LEARNING_MIRROR_PURGE_RE.test(relativeId)) {
        return true;
    }
    if (exports.BATTERY_RUNTIME_DIAG_PURGE_RE.test(relativeId)) {
        return true;
    }
    if (exports.STUB_ADDON_PURGE_RE.test(relativeId)) {
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
    if (isWallboxRuntimeBallast(relativeId)) {
        return true;
    }
    if (USER_INTENT_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (ADDON_MAPPING_RE.test(relativeId) || RUNTIME_SURFACE_RE.test(relativeId)) {
        return true;
    }
    if (FORECAST_PLAN_BALLAST_RE.test(relativeId) || DAILY_PLAN_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (FLEXIBLE_CONTRIB_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (LEARNING_HISTORY_JSON_RE.test(relativeId) ||
        HOUSE_LOAD_MIRROR_JSON_RE.test(relativeId) ||
        WEATHER_RAW_RE.test(relativeId) ||
        PV_HORIZON_RAW_RE.test(relativeId) ||
        WEATHER_KPI_BALLAST_RE.test(relativeId) ||
        PRICE_FORECAST_BALLAST_RE.test(relativeId) ||
        PRICE_LEARNING_BALLAST_RE.test(relativeId) ||
        HOUSE_LOAD_BALLAST_RE.test(relativeId) ||
        THERMAL_BOILER_BALLAST_RE.test(relativeId) ||
        THERMAL_RUNTIME_BALLAST_RE.test(relativeId) ||
        PV_BIAS_BALLAST_RE.test(relativeId) ||
        WEATHER_HORIZON_BALLAST_RE.test(relativeId) ||
        BACKUP_BALLAST_RE.test(relativeId) ||
        ECONOMICS_BALLAST_RE.test(relativeId) ||
        OPERATOR_STRATEGY_JSON_RE.test(relativeId) ||
        BATTERY_LEARNING_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (USER_INTENT_MIRROR_BALLAST_RE.test(relativeId) ||
        POLICY_BALLAST_RE.test(relativeId) ||
        LIVE_WALLBOX_RE.test(relativeId) ||
        OPERATOR_NOTIFICATION_BALLAST_RE.test(relativeId) ||
        GLOBAL_MODES_BALLAST_RE.test(relativeId) ||
        IMMERSION_RUNTIME_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (PLANNER_LAST_JSON_RE.test(relativeId) || WALLBOX_STATUS_BALLAST_RE.test(relativeId)) {
        return true;
    }
    if (WALLBOX_EVCC_BALLAST_RE.test(relativeId) || isWallboxFoundationBallast(relativeId)) {
        return true;
    }
    if (isBatteryBallast(relativeId)) {
        return true;
    }
    return AC_UNIT_RE.test(relativeId) || AC_MAPPING_RE.test(relativeId) || VEHICLE_FOLDER_RE.test(relativeId);
}
exports.isAllowlistedCleanupRelativeId = isAllowlistedCleanupRelativeId;
exports.CLEANUP_ALLOWLIST_DESCRIPTION = [
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
    "addons.*.mapping.* (native jsonConfig is source of truth)",
    "addons.*.runtime.surface.* (internal snapshot only)",
    "forecast/daily-plan extra JSON, contributions battery/wallbox JSON",
    "learning history/profile/health JSON + weather/pv raw leaves",
    "learning weather/price/house-load/thermal KPI ballast",
    "planner.intent.last_json / unused battery intent diagnosis",
    "wallbox status charging_mode* + EVCC/foundation/battery ballast",
    "live.wallbox.* (canonical EVCC telemetry)",
    "user_intent domain revision/last_changed/source_summary",
    "policy schema/engine/registry/provenance ballast",
    "immersion snapshot/slot/mandatory-flexible copies",
    ...exports.LEAN_PLANNER_PURGE_ROOTS.map((r) => `${r} (lean shadow surface purge)`),
];

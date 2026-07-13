"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNER_SNAPSHOT_FORBIDDEN_STATIC_IMPORTS = exports.assertCoverageMatrixComplete = exports.coverageCounts = exports.PLANNER_INPUT_COVERAGE_MATRIX = void 0;
function entry(legacySource, legacyId, consumer, snapshotField, transform, status = "covered", note) {
    return { legacySource, legacyId, consumer, snapshotField, transform, status, note };
}
/** Machine-readable input coverage matrix for legacy planner reads. */
exports.PLANNER_INPUT_COVERAGE_MATRIX = [
    // --- runPlannerTick / planner/inputs.ts ---
    entry("state", "live.pv.power_w", "runPlannerTick", "live.pvPowerW", "asNum; fallback live.battery.pv_ac_power_w"),
    entry("state", "live.battery.pv_ac_power_w", "runPlannerTick", "live.pvPowerW", "asNum fallback when live.pv.power_w null"),
    entry("state", "live.battery.house_load_w", "runPlannerTick", "live.houseLoadW", "asNum"),
    entry("state", "live.battery.soc_pct", "runPlannerTick", "live.socPct", "asNum"),
    entry("state", "live.thermal.buffer_temp_c", "runPlannerTick", "live.bufferTempC", "asNum"),
    entry("state", "global_modes.active", "runPlannerTick", "general.globalMode", "plannerModePolicyFromGlobalMode"),
    entry("state", "user_intent.thermal.resolved_json", "runPlannerTick", "intents.thermal", "parseResolvedIntentJson → mode + status"),
    entry("state", "user_intent.battery.resolved_json", "runPlannerTick", "intents.battery", "parseResolvedBatteryIntentJson → hold/charge/topOff"),
    entry("state", "addons.immersion_heater.governance.enabled", "runPlannerTick", "governance.addons[immersion_heater]", "bool"),
    entry("state", "addons.battery.governance.enabled", "runPlannerTick", "governance.addons[battery]", "bool"),
    entry("state", "addons.climate.governance.enabled", "runPlannerTick", "governance.addons[climate]", "bool"),
    entry("state", "addons.immersion_heater.governance.ai_optimization_allowed", "runPlannerTick", "governance.addons[immersion_heater].aiAllowed", "bool"),
    entry("state", "addons.battery.governance.ai_optimization_allowed", "runPlannerTick", "governance.addons[battery].aiAllowed", "bool"),
    entry("state", "learning.pv_bias.corrected_today_kwh", "runPlannerTick", "learning.pvBias.correctedTodayKwh", "asNum"),
    entry("state", "learning.pv_bias.corrected_tomorrow_kwh", "runPlannerTick", "learning.pvBias.correctedTomorrowKwh", "asNum"),
    entry("state", "learning.pv_bias.status", "runPlannerTick", "learning.pvBias.status", "string"),
    entry("state", "ems_mirror.snow_cover_suspected", "runPlannerTick", "general.snowCoverSuspected", "bool"),
    entry("config", "immersion_heater.*", "runPlannerTick", "thermal.config", "immersionDeviceConfigFromAdapter via readConfig; strip write paths"),
    entry("config", "air_conditioning.*", "runPlannerTick", "airConditioning.units", "acGlobalConfigFromAdapter via readConfig"),
    entry("config", "learning.weather.metrics.temp", "runPlannerTick", "live.outdoorTempC", "foreign actual then forecast"),
    entry("file", "learning/house_load/consumer_stats_v1.json", "runPlannerTick", "consumerStats", "readConsumerStatsPersist normalized entries"),
    entry("config", "battery_winter.*", "runPlannerTick", "batteryWinter.config", "batteryWinterPlanConfigFromAdapter via readConfig"),
    entry("state", "learning.pv_bias.corrected_today_kwh", "runPlannerTick", "batteryWinter.days[].pvKwh", "day 1 via readBatteryWinterDays logic"),
    entry("state", "learning.pv_bias.corrected_tomorrow_kwh", "runPlannerTick", "batteryWinter.days[].pvKwh", "day 2"),
    entry("state", "learning.pv_horizon.day3-7.corrected_kwh", "runPlannerTick", "batteryWinter.days[].pvKwh", "days 3-7"),
    entry("state", "learning.house_load.forecast_today_json", "runPlannerTick", "batteryWinter.days[].loadKwh", "dailyKwhFromHouseLoadForecast; file preferred"),
    entry("state", "learning.house_load.forecast_tomorrow_json", "runPlannerTick", "batteryWinter.days[].loadKwh", "dailyKwhFromHouseLoadForecast; file preferred"),
    entry("state", "learning.pv_bias.confidence_pct", "runPlannerTick", "batteryWinter.days[].pvConfidencePct", "per-day confidence"),
    entry("state", "learning.pv_horizon.day3-7.confidence_pct", "runPlannerTick", "batteryWinter.days[].pvConfidencePct", "horizon confidence"),
    entry("state", "live.price + Tibber JSON", "runPlannerTick", "prices.slots15Min", "collectGridSupplyBuildInput equivalent via builder"),
    entry("state", "addons.wallbox.status.evcc.battery_mode", "runPlannerTick", "wallbox.batteryMode", "string"),
    entry("state", "addons.wallbox.status.evcc.battery_discharge_control", "runPlannerTick", "wallbox.batteryDischargeControl", "bool"),
    entry("state", "addons.air_conditioning.units.unit_N.room_temp_c", "runPlannerTick", "airConditioning.units[].roomTempC", "per enabled unit"),
    // --- runGridSupplyTick / grid_read.ts ---
    entry("state", "policy.global.effective_json", "runGridSupplyTick", "policy.*", "parse once → typed policy fields; raw JSON excluded"),
    entry("state", "policy.global.revision", "runGridSupplyTick", "policy.revision", "string"),
    entry("state", "policy.global.status", "runGridSupplyTick", "policy.status", "string"),
    entry("config", "policy.global.*", "runGridSupplyTick", "policy.*", "admin fallback via readConfig.adminPolicy"),
    entry("state", "global_modes.active", "runGridSupplyTick", "general.globalMode", "shared with planner tick"),
    entry("state", "live.price.now_ct_per_kwh", "runGridSupplyTick", "live.currentPriceCtPerKwh", "asNum"),
    entry("state", "economics.config.fixed_price_ct_per_kwh", "runGridSupplyTick", "live.fixedPriceCtPerKwh", "asNum"),
    entry("config", "price_forecast.today_json_state_id", "runGridSupplyTick", "prices.slots15Min", "parseTibberPriceJsonTo15MinSlots"),
    entry("config", "price_forecast.tomorrow_json_state_id", "runGridSupplyTick", "prices.slots15Min", "parseTibberPriceJsonTo15MinSlots"),
    // --- runFlexibleContributionsTick / flexible/read.ts ---
    entry("state", "addons.battery.enabled", "runFlexibleContributionsTick", "governance.addons[battery].enabled", "bool"),
    entry("state", "addons.wallbox.enabled", "runFlexibleContributionsTick", "governance.addons[wallbox].enabled", "bool"),
    entry("state", "addons.immersion_heater.enabled", "runFlexibleContributionsTick", "governance.addons[immersion_heater].enabled", "bool"),
    entry("state", "addons.air_conditioning.enabled", "runFlexibleContributionsTick", "governance.addons[climate].enabled", "bool"),
    entry("state", "addons.wallbox.governance.enabled", "runFlexibleContributionsTick", "governance.addons[wallbox].governanceEnabled", "bool"),
    entry("state", BAT_ID("telemetry.soc_pct"), "runFlexibleContributionsTick", "battery.socPct", "asNum"),
    entry("state", BAT_ID("telemetry.capacity_effective_kwh"), "runFlexibleContributionsTick", "battery.capacityEffectiveKwh", "asNum"),
    entry("state", BAT_ID("identity.capacity_net_kwh"), "runFlexibleContributionsTick", "battery.capacityNetKwh", "asNum"),
    entry("state", BAT_ID("identity.capacity_source"), "runFlexibleContributionsTick", "battery.capacitySource", "string"),
    entry("state", BAT_ID("limits.hardware_min_soc_pct"), "runFlexibleContributionsTick", "battery.minSocPct", "asNum"),
    entry("state", BAT_ID("limits.hardware_max_soc_pct"), "runFlexibleContributionsTick", "battery.maxSocPct", "asNum"),
    entry("state", BAT_ID("limits.effective_max_charge_w"), "runFlexibleContributionsTick", "battery.maxChargeW", "asNum"),
    entry("state", BAT_ID("capabilities.set_charge_power"), "runFlexibleContributionsTick", "battery.chargeCapable", "bool"),
    entry("state", BAT_ID("capabilities.set_discharge_power"), "runFlexibleContributionsTick", "battery.dischargeCapable", "bool"),
    entry("state", BAT_ID("status.fault"), "runFlexibleContributionsTick", "battery.fault", "bool"),
    entry("state", BAT_ID("status.lockout"), "runFlexibleContributionsTick", "battery.lockout", "bool"),
    entry("state", BAT_ID("telemetry.valid"), "runFlexibleContributionsTick", "battery.telemetryValid", "bool"),
    entry("state", BAT_ID("telemetry.stale"), "runFlexibleContributionsTick", "battery.telemetryStale", "bool"),
    entry("state", BAT_ID("status.telemetry_ready"), "runFlexibleContributionsTick", "battery.telemetryReady", "bool"),
    entry("state", BAT_ID("runtime.ownership_active"), "runFlexibleContributionsTick", "battery.ownershipActive", "bool"),
    entry("state", "planner.intent.battery.winter.active", "runFlexibleContributionsTick", "battery.winterGridActive", "bool"),
    entry("state", "addons.wallbox.status.evcc.connected", "runFlexibleContributionsTick", "wallbox.connected", "bool"),
    entry("state", "addons.wallbox.status.evcc.charging", "runFlexibleContributionsTick", "wallbox.charging", "bool"),
    entry("state", "addons.wallbox.status.evcc.vehicle_soc_pct", "runFlexibleContributionsTick", "wallbox.vehicleSocPct", "asNum"),
    entry("state", "addons.wallbox.status.evcc.plan_soc_pct", "runFlexibleContributionsTick", "wallbox.planSocPct", "asNum"),
    entry("state", "addons.wallbox.status.evcc.plan_active", "runFlexibleContributionsTick", "wallbox.planActive", "bool"),
    entry("state", "addons.wallbox.status.evcc.session_energy_kwh", "runFlexibleContributionsTick", "wallbox.sessionEnergyKwh", "asNum"),
    entry("state", "addons.wallbox.status.evcc.effective_plan_time", "runFlexibleContributionsTick", "wallbox.deadlineIso", "validIsoDeadline"),
    entry("state", "addons.wallbox.status.evcc.active_phases", "runFlexibleContributionsTick", "wallbox.activePhases", "asNum"),
    entry("state", "addons.wallbox.status.evcc.max_current_a", "runFlexibleContributionsTick", "wallbox.maxCurrentA", "asNum"),
    entry("config", "wallbox.evcc.enabled_state_id", "runFlexibleContributionsTick", "wallbox.evccConfigured", "non-empty config flag"),
    entry("state", "addons.immersion_heater.runtime.buffer_temperature_c", "runFlexibleContributionsTick", "thermal.bufferTempC", "asNum"),
    entry("state", "addons.immersion_heater.runtime.fault_active", "runFlexibleContributionsTick", "thermal.faultActive", "bool"),
    entry("state", "addons.immersion_heater.runtime.state", "runFlexibleContributionsTick", "thermal.runtimeState", "string"),
    entry("state", "addons.air_conditioning.units.unit_N.state", "runFlexibleContributionsTick", "airConditioning.units[].state", "fault/lockout derivation in worker phase"),
    entry("state", "addons.air_conditioning.units.unit_N.cleaning_active", "runFlexibleContributionsTick", "airConditioning.units[].cleaningActive", "bool"),
    // --- runForecastPlanTick / contributions/read.ts ---
    entry("state", "learning.pv_bias.raw_today_kwh", "runForecastPlanTick", "learning.pvBias.rawTodayKwh", "asNum"),
    entry("state", "learning.pv_bias.raw_tomorrow_kwh", "runForecastPlanTick", "learning.pvBias.rawTomorrowKwh", "asNum"),
    entry("state", "learning.pv_bias.confidence_pct", "runForecastPlanTick", "learning.pvBias.confidencePct", "asNum"),
    entry("state", "learning.pv_bias.last_update_ts", "runForecastPlanTick", "learning.pvBias.lastUpdateTs", "string"),
    entry("state", "learning.pv_horizon.day3.corrected_kwh", "runForecastPlanTick", "learning.pvHorizon[2]", "asNum"),
    entry("state", "learning.pv_horizon.day4.corrected_kwh", "runForecastPlanTick", "learning.pvHorizon[3]", "asNum"),
    entry("state", "learning.pv_horizon.day5.corrected_kwh", "runForecastPlanTick", "learning.pvHorizon[4]", "asNum"),
    entry("state", "learning.pv_horizon.day6.corrected_kwh", "runForecastPlanTick", "learning.pvHorizon[5]", "asNum"),
    entry("state", "learning.pv_horizon.day7.corrected_kwh", "runForecastPlanTick", "learning.pvHorizon[6]", "asNum"),
    entry("state", "learning.pv_horizon.day3.confidence_pct", "runForecastPlanTick", "learning.pvHorizon[2].confidencePct", "asNum"),
    entry("state", "learning.pv_horizon.day4.confidence_pct", "runForecastPlanTick", "learning.pvHorizon[3].confidencePct", "asNum"),
    entry("state", "learning.pv_horizon.day5.confidence_pct", "runForecastPlanTick", "learning.pvHorizon[4].confidencePct", "asNum"),
    entry("state", "learning.pv_horizon.day6.confidence_pct", "runForecastPlanTick", "learning.pvHorizon[5].confidencePct", "asNum"),
    entry("state", "learning.pv_horizon.day7.confidence_pct", "runForecastPlanTick", "learning.pvHorizon[6].confidencePct", "asNum"),
    entry("state", "learning.house_load.status", "runForecastPlanTick", "learning.houseLoad.status", "string; file health override"),
    entry("state", "learning.house_load.confidence", "runForecastPlanTick", "learning.houseLoad.confidence", "asNum; file override"),
    entry("state", "learning.house_load.last_update", "runForecastPlanTick", "learning.houseLoad.lastUpdate", "string; file generated_at override"),
    entry("file", "learning/house_load/house_load_learning_v1.json", "runForecastPlanTick", "learning.houseLoad.forecastToday/Tomorrow", "prefer persist forecasts over state JSON"),
    entry("state", "learning.weather.status", "runForecastPlanTick", "learning.weather.status", "string"),
    entry("state", "learning.weather.health", "runForecastPlanTick", "learning.weather.health", "string"),
    entry("state", "learning.weather.confidence_pct", "runForecastPlanTick", "learning.weather.confidencePct", "asNum"),
    entry("state", "learning.weather.last_update", "runForecastPlanTick", "learning.weather.lastUpdate", "string"),
    entry("state", "learning.weather.forecast_source", "runForecastPlanTick", "learning.weather.forecastSource", "string"),
    entry("state", "learning.weather.actual_source", "runForecastPlanTick", "learning.weather.actualSource", "string"),
    entry("config", "learning.weather.metrics.cloud", "runForecastPlanTick", "live.cloudPct", "foreign actual then forecast"),
    // --- thermal runtime learning (worker input; states mirrored from persist) ---
    entry("state", "learning.thermal_runtime.status", "runForecastPlanTick", "learning.thermalRuntime.status", "string"),
    entry("state", "learning.thermal_runtime.health", "runForecastPlanTick", "learning.thermalRuntime.health", "string"),
    entry("state", "learning.thermal_runtime.samples", "runForecastPlanTick", "learning.thermalRuntime.samples", "asNum"),
    entry("state", "learning.thermal_runtime.runtime_hours_avg", "runForecastPlanTick", "learning.thermalRuntime.runtimeHoursAvg", "asNum"),
    entry("state", "learning.thermal_runtime.runtime_hours_median", "runForecastPlanTick", "learning.thermalRuntime.runtimeHoursMedian", "asNum"),
    entry("state", "learning.thermal_runtime.cooling_rate_c_per_h_avg", "runForecastPlanTick", "learning.thermalRuntime.coolingRateCPerHAvg", "asNum"),
    entry("state", "learning.thermal_runtime.cooling_k_per_h", "runForecastPlanTick", "learning.thermalRuntime.coolingKPerH", "asNum"),
    entry("state", "learning.thermal_runtime.cooling_asymptote_c", "runForecastPlanTick", "learning.thermalRuntime.coolingAsymptoteC", "asNum"),
    entry("state", "learning.thermal_runtime.cooling_asymptote_source", "runForecastPlanTick", "learning.thermalRuntime.coolingAsymptoteSource", "string"),
    entry("state", "learning.thermal_runtime.current_temperature_c", "runForecastPlanTick", "learning.thermalRuntime.currentTemperatureC", "asNum"),
    entry("state", "learning.thermal_runtime.estimated_remaining_hours", "runForecastPlanTick", "learning.thermalRuntime.estimatedRemainingHours", "asNum"),
    entry("state", "learning.thermal_runtime.estimated_empty_at", "runForecastPlanTick", "learning.thermalRuntime.estimatedEmptyAt", "string"),
    entry("file", "learning/thermal_runtime/thermal_runtime_learning_v1.json", "runForecastPlanTick", "learning.thermalRuntime", "full persist: by_season, by_day_type, history"),
    // --- runDailyPlanTick / daily_plan/tick.ts ---
    entry("config", "intent.admin.timezone", "runDailyPlanTick", "timezone", "via readConfig.timezone"),
    entry("config", "policy.preferences.energyPriority", "runDailyPlanTick", "policy.energyPriority", "admin fallback"),
    entry("config", "policy.protection.mutualExclusions", "runDailyPlanTick", "policy.mutualExclusions", "admin fallback"),
    // --- intentionally removed legacy reads / outputs ---
    entry("state", "planner.intent.last_json", "runPlannerTick", "—", "planner output not planner input", "intentionally_removed", "Prior tick output; worker recomputes intent"),
    entry("state", "planner.intent.thermal.commanded_stage", "immersion runtime engine", "—", "feedback from prior planner write", "intentionally_removed", "Not consumed by listed planner ticks"),
    entry("state", "planner.intent.thermal.target_temp_c", "immersion runtime engine", "—", "feedback from prior planner write", "intentionally_removed"),
    entry("state", "forecast_plan.plan_json", "runDailyPlanTick", "—", "in-memory ForecastPlan passed between ticks", "intentionally_removed", "Worker receives forecast via job pipeline not state re-read"),
    entry("state", "daily_plan.plan_json", "addons", "—", "planner output", "intentionally_removed"),
    entry("state", "allocation.*.plan_json", "addons", "—", "planner output", "intentionally_removed"),
    entry("state", "learning.thermal_runtime.history_json", "learning", "learning.thermalRuntime.history", "from persist file not raw state blob", "intentionally_removed", "Avoid large JSON state hotpath"),
    entry("state", "learning.thermal_runtime.by_season_json", "learning", "learning.thermalRuntime.bySeason", "from persist file", "intentionally_removed"),
    entry("state", "learning.thermal_runtime.by_day_type_json", "learning", "learning.thermalRuntime.byDayType", "from persist file", "intentionally_removed"),
    entry("state", "addons.wallbox.status.evcc.snapshot_json", "runFlexibleContributionsTick", "—", "typed scalar fields instead", "intentionally_removed"),
    entry("state", "addons.immersion_heater.runtime.snapshot_json", "runFlexibleContributionsTick", "—", "typed scalar fields instead", "intentionally_removed"),
    entry("config", "immersion_heater.stages[].setStateId", "runPlannerTick", "—", "device write path", "intentionally_removed", "Only stage label/power in thermal.config.stages"),
    entry("config", "immersion_heater.stages[].feedbackStateId", "runPlannerTick", "—", "device read mapping path", "intentionally_removed"),
    entry("state", "learning.thermal_runtime.last_run", "learning", "—", "not used by planner ticks", "intentionally_removed", "Diagnostic only"),
    entry("state", "learning.thermal_runtime.last_error", "learning", "—", "not used by planner ticks", "intentionally_removed"),
];
function BAT_ID(suffix) {
    return `addons.battery.${suffix}`;
}
function coverageCounts() {
    const counts = {
        covered: 0,
        intentionally_removed: 0,
        unresolved: 0,
    };
    for (const row of exports.PLANNER_INPUT_COVERAGE_MATRIX) {
        counts[row.status] += 1;
    }
    return counts;
}
exports.coverageCounts = coverageCounts;
function assertCoverageMatrixComplete() {
    const unresolved = exports.PLANNER_INPUT_COVERAGE_MATRIX.filter((r) => r.status === "unresolved");
    if (unresolved.length > 0) {
        throw new Error(`coverage matrix has ${unresolved.length} unresolved entries`);
    }
}
exports.assertCoverageMatrixComplete = assertCoverageMatrixComplete;
exports.PLANNER_SNAPSHOT_FORBIDDEN_STATIC_IMPORTS = [
    "planner_worker/main",
    "planner/run",
    "planner/index",
    "operator/forecast/tick",
    "operator/daily_plan/tick",
    "operator/contributions/flexible/tick",
    "addons/battery/runtime/engine",
    "addons/immersion_heater/runtime/engine",
    "addons/air_conditioning/runtime/engine",
    "addons/wallbox/runtime/engine",
];

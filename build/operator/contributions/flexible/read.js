"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectFlexibleContributions = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const config_1 = require("../../../addons/battery/config");
const limits_1 = require("../../../addons/battery/core/limits");
const ensure_states_1 = require("../../../addons/battery/ensure_states");
const intent_read_1 = require("../../../addons/battery/runtime/intent_read");
const ensure_evcc_states_1 = require("../../../addons/wallbox/ensure_evcc_states");
const states_1 = require("../../../addons/wallbox/runtime/states");
const ensure_states_2 = require("../../../addons/wallbox/ev_foundation/ensure_states");
const config_2 = require("../../../addons/wallbox/ev_foundation/config");
const evcc_config_1 = require("../../../addons/wallbox/evcc_config");
const vehicle_map_1 = require("../../../addons/wallbox/vehicle_map");
const config_3 = require("../../../intent/config");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const hygiene_1 = require("../../../addons/immersion_heater/hygiene");
const types_1 = require("../../../addons/immersion_heater/runtime/types");
const flex_demand_1 = require("./flex_demand");
const config_4 = require("../../../addons/air_conditioning/config");
const climate_thermal_1 = require("../../../learning/climate_thermal");
const weather_hourly_1 = require("../weather_hourly");
const pv_shape_config_1 = require("../pv_shape_config");
const constants_1 = require("../../../addons/air_conditioning/constants");
const ensure_states_3 = require("../../../addons/air_conditioning/runtime/ensure_states");
const governance_1 = require("../../../addons/governance");
const ensure_states_4 = require("../../../addons/governance/ensure_states");
const config_5 = require("../../../learning/weather/config");
const consumer_stats_1 = require("../../../learning/consumer_stats");
const persist_1 = require("../../../learning/consumer_stats/persist");
const climate_shared_power_1 = require("../../../learning/climate_shared_power");
const constants_2 = require("../../../learning/pv_horizon/constants");
const tree_paths_1 = require("../../../tree_paths");
const execution_mode_1 = require("../../../execution_mode");
const mode_policy_1 = require("../../../planner/mode_policy");
const intent_read_2 = require("../../../addons/immersion_heater/runtime/intent_read");
const time_1 = require("../../time");
const config_6 = require("../../../intent/config");
const house_load_1 = require("../house_load");
const read_1 = require("../read");
const build_1 = require("./build");
const battery_charge_logic_1 = require("./battery_charge_logic");
const battery_charge_logic_config_1 = require("./battery_charge_logic_config");
const battery_pv_cover_1 = require("./battery_pv_cover");
const battery_learning_1 = require("./battery_learning");
const thermal_learning_1 = require("./thermal_learning");
const battery_consumers_1 = require("../../../policy/battery_consumers");
async function readNum(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readBool(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val === true || st?.val === false)
            return st.val;
        if (st?.val === 1 || st?.val === "1" || st?.val === "true")
            return true;
        if (st?.val === 0 || st?.val === "0" || st?.val === "false")
            return false;
        return null;
    }
    catch {
        return null;
    }
}
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
async function readConsumerStats(host) {
    const dir = host.getAbsolutePath?.(consumer_stats_1.PERSIST_CATEGORY);
    if (!dir)
        return null;
    try {
        return await (0, persist_1.readConsumerStatsPersist)(dir);
    }
    catch {
        return null;
    }
}
/** PHASE 3 — Shared-Power/Climate Learning: Reliability-Gate-Basis für `planCooling`. */
async function readClimateSharedPowerStats(host) {
    const getAbsolutePath = host.getAbsolutePath;
    if (!getAbsolutePath)
        return undefined;
    try {
        const persist = await (0, climate_shared_power_1.loadClimateSharedPowerStats)({
            getAbsolutePath: (category) => getAbsolutePath(category ?? ""),
        });
        return persist.stats;
    }
    catch {
        return undefined;
    }
}
async function readOutdoorTempC(host) {
    const weather = (0, config_5.weatherConfigFromAdapter)(host.config);
    const tempMetric = weather.metrics.temp;
    if (!tempMetric)
        return null;
    const actual = tempMetric.actualStateId
        ? await readForeignNum(host, tempMetric.actualStateId)
        : null;
    if (actual !== null)
        return actual;
    return tempMetric.forecastStateId ? readForeignNum(host, tempMetric.forecastStateId) : null;
}
async function readForeignNum(host, stateId) {
    if (!stateId.trim())
        return null;
    try {
        const st = await host.getForeignStateAsync?.(stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
function validIsoDeadline(raw) {
    if (!raw?.trim())
        return null;
    if (raw.startsWith("0001-01-01T00:00:00"))
        return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
async function readThermalLearningSignal(host, now) {
    return readVesselLearningSignal(host, now, "learning.thermal_runtime");
}
/** Boiler-Learning — Hard-Deadline; nie aus Puffer-States lesen. */
async function readBoilerLearningSignal(host, now) {
    return readVesselLearningSignal(host, now, "learning.thermal_boiler");
}
async function readVesselLearningSignal(host, now, base) {
    const timezone = (0, config_6.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
    const [rawStatus, rawHealth, samples, coolingRateCPerHAvg, coolingConstantPerH, coolingAsymptoteC, estimatedRemainingHours, estimatedEmptyAtRaw, byDayTypeJsonRaw,] = await Promise.all([
        readStr(host, `${base}.status`),
        readStr(host, `${base}.health`),
        readNum(host, `${base}.samples`),
        readNum(host, `${base}.cooling_rate_c_per_h_avg`),
        readNum(host, `${base}.cooling_k_per_h`),
        readNum(host, `${base}.cooling_asymptote_c`),
        readNum(host, `${base}.estimated_remaining_hours`),
        readStr(host, `${base}.estimated_empty_at`),
        readStr(host, `${base}.by_day_type_json`),
    ]);
    return (0, thermal_learning_1.buildThermalLearningSignal)({
        now,
        rawStatus,
        rawHealth,
        samples,
        coolingRateCPerHAvg,
        coolingConstantPerH,
        coolingAsymptoteC,
        estimatedRemainingHours,
        estimatedEmptyAtRaw,
        byDayTypeJsonRaw,
        timezone,
        vessel: base.endsWith("thermal_boiler") ? "boiler" : "buffer",
    });
}
async function readBatteryLearningSignal(host) {
    const [rawStatus, sampleDays, avgNightDischargeKwh, avgChargePowerW, maxChargePowerW, topoffDueRaw, topoffDaysRemaining, estimatedRuntimeDays,] = await Promise.all([
        readStr(host, "learning.battery_runtime.status"),
        readNum(host, "learning.battery_runtime.sample_days"),
        readNum(host, "learning.battery_runtime.avg_night_discharge_kwh"),
        readNum(host, "learning.battery_runtime.avg_charge_power_w"),
        readNum(host, "learning.battery_runtime.max_charge_power_w"),
        readNum(host, "learning.battery_runtime.topoff_due"),
        readNum(host, "learning.battery_runtime.topoff_days_remaining"),
        readNum(host, "learning.battery_runtime.estimated_runtime_days"),
    ]);
    return (0, battery_learning_1.buildBatteryLearningSignal)({
        rawStatus,
        sampleDays,
        avgNightDischargeKwh,
        avgChargePowerW,
        maxChargePowerW,
        topoffDueRaw,
        topoffDaysRemaining,
        estimatedRuntimeDays,
    });
}
/**
 * PV-Defizit-Ladelogik (Block 2, `battery_charge_logic.ts`) — liest denselben PV-/Hauslast-
 * Horizont (Tag 0–7) wie die Forecast-Plan-Contributions (Block 1.4), unabhängig von deren
 * bereits gebauten PlanContribution-Objekten (die Flexible-Contributions laufen im Tick vor
 * dem Forecast Plan, siehe `src/ems_light/tick.ts`).
 */
async function readBatteryChargeLogicDecision(host, now, socPct, governanceEnabled, modePolicy) {
    const timezone = (0, config_6.intentAdminConfigFromAdapter)(host.config).timezone;
    const [correctedTodayKwh, correctedTomorrowKwh, pvConfidence, forecastTodayRaw, forecastTomorrowRaw, forecastHorizonRaw, snowCoverSuspected,] = await Promise.all([
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readNum(host, "learning.pv_bias.confidence_pct"),
        readStr(host, "learning.house_load.forecast_today_json"),
        readStr(host, "learning.house_load.forecast_tomorrow_json"),
        readStr(host, "learning.house_load.forecast_horizon_json"),
        readBool(host, "ems_mirror.snow_cover_suspected"),
    ]);
    const [pvHorizonValues, pvHorizonConfidence] = await Promise.all([
        Promise.all(Array.from({ length: constants_2.PV_HORIZON_DAY_COUNT - constants_2.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_2.PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`))),
        Promise.all(Array.from({ length: constants_2.PV_HORIZON_DAY_COUNT - constants_2.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => readNum(host, `learning.pv_horizon.day${constants_2.PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`))),
    ]);
    const houseHorizon = (0, read_1.parseHouseLoadForecastHorizonJson)(forecastHorizonRaw);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const days = [
        {
            dayIndex: 0,
            dateKey: todayKey,
            pvKwh: correctedTodayKwh,
            loadKwh: (0, house_load_1.dailyKwhFromHouseLoadDayForecast)((0, read_1.parseHouseLoadForecastJson)(forecastTodayRaw)),
            pvConfidencePct: pvConfidence,
        },
        {
            dayIndex: 1,
            dateKey: (0, time_1.addDaysToDateKey)(todayKey, 1),
            pvKwh: correctedTomorrowKwh,
            loadKwh: (0, house_load_1.dailyKwhFromHouseLoadDayForecast)((0, read_1.parseHouseLoadForecastJson)(forecastTomorrowRaw)),
            pvConfidencePct: pvConfidence,
        },
    ];
    for (let d = constants_2.PV_HORIZON_EXTENDED_FIRST_DAY; d <= constants_2.PV_HORIZON_DAY_COUNT; d++) {
        const idx = d - constants_2.PV_HORIZON_EXTENDED_FIRST_DAY;
        days.push({
            dayIndex: d - 1,
            dateKey: (0, time_1.addDaysToDateKey)(todayKey, d - 1),
            pvKwh: pvHorizonValues[idx] ?? null,
            loadKwh: (0, house_load_1.dailyKwhFromHouseLoadDayForecast)(houseHorizon?.[idx] ?? null),
            pvConfidencePct: pvHorizonConfidence[idx] ?? null,
        });
    }
    return (0, battery_charge_logic_1.planBatteryChargeLogic)({
        now,
        socPct,
        snowCoverSuspected: snowCoverSuspected === true,
        config: (0, battery_charge_logic_config_1.batteryChargeLogicConfigFromAdapter)(host.config),
        modePolicy,
        governanceEnabled,
        days,
    });
}
async function collectFlexibleContributions(host, now, gridForecast) {
    const config = host.config;
    const timezone = (0, config_6.intentAdminConfigFromAdapter)(config).timezone || "Europe/Berlin";
    const globalModeRaw = await readStr(host, "global_modes.active");
    const modePolicy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(globalModeRaw);
    const globalModeOff = modePolicy.mode === "off";
    const batteryCfg = (0, config_1.batteryConfigFromAdapter)(config);
    const [batteryEnabled, batteryGov, wallboxEnabled, wallboxGov, immersionEnabled, immersionGov, climateEnabled, climateGov, socPct, capacityEffective, capacityNet, capacitySource, batteryFault, batteryLockout, telemetryValid, telemetryStale, telemetryReady, ownershipActive, batteryIntentRaw, connected, charging, vehicleSoc, planSoc, planActive, sessionKwh, chargeRemainingKwh, effectiveLimitSoc, deadlineRaw, activePhases, maxCurrentA, evccVehicleName, evccVehicleTitle, bufferTemp, immersionFault, immersionState, autoTargetReached, thermalRaw, pvToday, pvTomorrow, pvBiasStatus, aiThermal, outdoorTemp, outdoorForecastMaxC, houseLoadTodayRaw,] = await Promise.all([
        readBool(host, (0, tree_paths_1.addonEnabled)("battery")),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "battery"),
        readBool(host, (0, tree_paths_1.addonEnabled)("wallbox")),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "wallbox"),
        readBool(host, (0, tree_paths_1.addonEnabled)("immersion_heater")),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "immersion_heater"),
        readBool(host, (0, tree_paths_1.addonEnabled)("air_conditioning")),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "climate"),
        readNum(host, ensure_states_1.BAT.telemetry.socPct),
        readNum(host, ensure_states_1.BAT.telemetry.capacityEffectiveKwh),
        readNum(host, ensure_states_1.BAT.identity.capacityNetKwh),
        readStr(host, ensure_states_1.BAT.identity.capacitySource),
        readBool(host, ensure_states_1.BAT.status.fault),
        readBool(host, ensure_states_1.BAT.status.lockout),
        readBool(host, ensure_states_1.BAT.telemetry.valid),
        readBool(host, ensure_states_1.BAT.telemetry.stale),
        readBool(host, ensure_states_1.BAT.status.telemetryReady),
        readBool(host, ensure_states_1.BAT.runtime.ownershipActive),
        host.getStateAsync("user_intent.battery.resolved_json"),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planSocPct),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.sessionEnergyKwh),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectiveLimitSocPct),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.activePhases),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.maxCurrentA),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleName),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleTitle),
        readNum(host, types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC),
        readBool(host, types_1.IMMERSION_RUNTIME_STATES.faultActive),
        readStr(host, types_1.IMMERSION_RUNTIME_STATES.state),
        readBool(host, types_1.IMMERSION_RUNTIME_STATES.autoTargetReached),
        host.getStateAsync("user_intent.thermal.resolved_json"),
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readStr(host, "learning.pv_bias.status"),
        readBool(host, (0, ensure_states_4.addonGovernanceAiAllowedState)("immersion_heater")),
        readOutdoorTempC(host),
        readNum(host, "learning.weather.horizon.day1.max_temp_c"),
        readStr(host, "learning.house_load.forecast_today_json"),
    ]);
    const [batteryModeRaw, wallboxModeRaw, immersionModeRaw, climateModeRaw] = await Promise.all([
        readStr(host, (0, tree_paths_1.addonMode)("battery")),
        readStr(host, (0, tree_paths_1.addonMode)("wallbox")),
        readStr(host, (0, tree_paths_1.addonMode)("immersion_heater")),
        readStr(host, (0, tree_paths_1.addonMode)("air_conditioning")),
    ]);
    const batteryIntent = (0, intent_read_1.parseResolvedBatteryIntentJson)(batteryIntentRaw?.val);
    const topOff = batteryIntent?.top_off_requested?.status === "valid" && batteryIntent.top_off_requested.value === true;
    const thermalIntent = (0, intent_read_2.parseResolvedIntentJson)(thermalRaw?.val);
    const thermalMode = (0, intent_read_2.resolvedModeFromIntent)(thermalIntent);
    const immersionConfig = (0, device_config_1.immersionDeviceConfigFromAdapter)(config);
    const relayMapped = immersionConfig.stages.some((s) => s.enabled && s.setStateId.trim() !== "");
    const evccCfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(config);
    const evccConfigured = evccCfg.enabledStateId.trim().length > 0;
    const evFoundation = (0, config_2.evFoundationConfigFromAdapter)(config);
    const [externalAuthorityState, takeoverSeverity, externalSmartPlanJson, externalMinSocPct, evccChargePowerW, evccLoadpointMode, evccBatteryBoost, tibberRewardsRuntime,] = await Promise.all([
        readStr(host, ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.externalAuthorityState),
        readStr(host, ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.takeoverSeverity),
        readStr(host, ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson),
        readNum(host, ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.loadpointMode),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryBoost),
        readBool(host, states_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive),
    ]);
    const remainingEnergyKwh = chargeRemainingKwh !== null && Number.isFinite(chargeRemainingKwh)
        ? Math.max(0, chargeRemainingKwh)
        : null;
    const minSoc = batteryCfg.limits.minSocPct;
    const maxSoc = batteryCfg.limits.maxSocPct;
    const chargeCapable = batteryCfg.profile !== "generic_readonly";
    const dischargeCapable = (0, limits_1.hasDischargeCapability)(batteryCfg.limits);
    const mapEntry = (0, vehicle_map_1.lookupVehicleMapEntry)((0, vehicle_map_1.wallboxVehicleMapFromAdapter)(config).entries, evccVehicleName, evccVehicleTitle);
    const vehicleCapacityKwh = mapEntry?.batteryCapacityNetKwh !== null &&
        mapEntry?.batteryCapacityNetKwh !== undefined &&
        mapEntry.batteryCapacityNetKwh > 0
        ? mapEntry.batteryCapacityNetKwh
        : null;
    const vehicleMaxAcChargePowerW = mapEntry?.maxAcChargePowerW !== null &&
        mapEntry?.maxAcChargePowerW !== undefined &&
        mapEntry.maxAcChargePowerW > 0
        ? mapEntry.maxAcChargePowerW
        : null;
    const energyToTargetKwh = remainingEnergyKwh;
    const minDepartureSoc = evFoundation.minimumDepartureSocPct;
    const energyToDepartureMinimumKwh = minDepartureSoc !== null &&
        minDepartureSoc !== undefined &&
        vehicleSoc !== null &&
        vehicleCapacityKwh !== null
        ? Math.max(0, ((minDepartureSoc - vehicleSoc) / 100) * vehicleCapacityKwh)
        : null;
    let fallbackTargetSocPct = null;
    const intentEvcc = (0, config_3.intentEvccConfigFromAdapter)(config);
    if (intentEvcc.targetSocStateId) {
        fallbackTargetSocPct = await readForeignNum(host, intentEvcc.targetSocStateId);
        if (fallbackTargetSocPct !== null && !(fallbackTargetSocPct > 0 && fallbackTargetSocPct <= 100)) {
            fallbackTargetSocPct = null;
        }
    }
    const acConfig = (0, config_4.acGlobalConfigFromAdapter)(config);
    const stats = await readConsumerStats(host);
    const climateSharedPowerStats = await readClimateSharedPowerStats(host);
    const hourlyPrefix = (0, pv_shape_config_1.pvShapeConfigFromAdapter)(config).brightskyHourlyPrefix;
    const [hourlyPoints, thermalPersist] = await Promise.all([
        (0, weather_hourly_1.collectWeatherHourlyPoints)(host, now, timezone, hourlyPrefix).catch(() => []),
        host.getAbsolutePath
            ? (0, climate_thermal_1.loadClimateThermalPersist)({
                getAbsolutePath: (category) => host.getAbsolutePath(category ?? ""),
            }).catch(() => null)
            : Promise.resolve(null),
    ]);
    const thermalModels = thermalPersist?.units ?? undefined;
    const thermalLearning = await readThermalLearningSignal(host, now);
    const boilerLearning = await readBoilerLearningSignal(host, now);
    const boilerTempLive = await readNum(host, "live.thermal.boiler_temp_c");
    const boilerTemp = boilerTempLive ??
        (immersionConfig.boilerTempEnabled && immersionConfig.boilerTempStateId
            ? await readForeignNum(host, immersionConfig.boilerTempStateId)
            : null);
    const boilerSensorDegraded = boilerTemp === null;
    const hygienePersistRaw = await readStr(host, "addons.immersion_heater.runtime.hygiene_json");
    let lastHygieneIso = null;
    try {
        const hj = hygienePersistRaw ? JSON.parse(hygienePersistRaw) : null;
        if (hj && typeof hj.lastBoilerHygieneAtIso === "string")
            lastHygieneIso = hj.lastBoilerHygieneAtIso;
    }
    catch {
        /* ignore */
    }
    const hygiene = (0, hygiene_1.evaluateHygieneDuty)({
        nowMs: now.getTime(),
        boilerTempC: boilerTemp,
        hygieneTargetTempC: immersionConfig.hygieneTargetTempC,
        bufferTempC: bufferTemp,
        bufferMaxTempC: immersionConfig.planningMaxTempC,
        lastBoilerHygieneAtIso: lastHygieneIso,
        kwhPerDegreeC: flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C,
    });
    const batteryLearning = await readBatteryLearningSignal(host);
    const chargeLogic = await readBatteryChargeLogicDecision(host, now, socPct, batteryGov, modePolicy);
    /*
     * Heizstab-/Thermal-Block: reale Inputs statt immer-null für die gemeinsame Reserve-Bewertung
     * (thermal_reserve_evaluation.ts) — Policy-Zugriff (Phase 1a) und zentrale Batterie-Reserve
     * (Batterie-Block), beide bereits an anderer Stelle berechnet/veröffentlicht.
     */
    const mayUseBatteryForImmersion = await readBool(host, battery_consumers_1.BATTERY_CONSUMER_CONSTRAINT_STATES.immersion_heater.allowed);
    const centralBatteryReserveRequiredSocAtPvEndPct = await readNum(host, "planner.battery_reserve.required_soc_at_pv_end_pct");
    const importTariffCtPerKwh = await readNum(host, "live.price.now_ct_per_kwh");
    const houseLoadTodayKwh = (0, house_load_1.dailyKwhFromHouseLoadDayForecast)((0, read_1.parseHouseLoadForecastJson)(houseLoadTodayRaw));
    const batteryTodayPvSurplusKwh = (0, battery_pv_cover_1.todayPvSurplusKwh)(pvToday, houseLoadTodayKwh);
    // Technische Hardwaregrenze aus Admin-Config (`bat_hw_max_charge_w`) — nie Runtime-Befehl
    // und nie Netz-/Hausanschluss-Grenze als Planungs-Cap.
    const hwMaxChargeW = batteryCfg.limits.maxChargeW !== null && batteryCfg.limits.maxChargeW > 0
        ? batteryCfg.limits.maxChargeW
        : null;
    const acUnits = await Promise.all(Array.from({ length: constants_1.AC_UNIT_COUNT }, async (_, i) => {
        const index = i + 1;
        const unit = acConfig.units.find((u) => u.index === index);
        const ids = (0, ensure_states_3.acUnitRuntimeStates)(index);
        const [roomTempC, roomHumidityPct, faultState, cleaningActive, liveSetpointC] = await Promise.all([
            readNum(host, ids.roomTempC),
            readNum(host, ids.roomHumidityPct),
            readStr(host, ids.state),
            readBool(host, ids.cleaningActive),
            readNum(host, ids.setpointTempC),
        ]);
        const heatSetpointC = unit.heatSetpointC ??
            ((0, config_4.acModeCommandEnabled)(unit.modeWhenHeating) && liveSetpointC != null && liveSetpointC > 0
                ? liveSetpointC
                : null);
        const plannedUnit = heatSetpointC !== unit.heatSetpointC ? { ...unit, heatSetpointC } : unit;
        const consumerKey = (0, constants_1.acUnitConsumerKey)(index);
        return {
            unit: plannedUnit,
            roomTempC,
            roomHumidityPct,
            consumerStats: stats?.consumers?.[consumerKey],
            mappingsReady: unit.enabled,
            fault: faultState === "fault",
            lockout: faultState === "blocked" || faultState === "rate_limited",
            cleaningBlocked: cleaningActive === true,
        };
    }));
    const contributions = (0, build_1.buildFlexibleContributions)({
        battery: {
            now,
            addonEnabled: batteryEnabled !== false,
            governanceEnabled: batteryGov,
            globalModeOff,
            addonExecutionOff: (0, execution_mode_1.parseAddonMode)(batteryModeRaw) === "off",
            modePolicy,
            gridForecast,
            profileId: (0, config_1.batteryProfileIdFromConfig)(config),
            socPct,
            capacityManualKwh: batteryCfg.capacityManualKwh,
            capacityMappedKwh: capacityNet ?? capacityEffective,
            capacitySource,
            minSocPct: minSoc,
            maxSocPct: maxSoc,
            maxChargeW: hwMaxChargeW,
            chargeCapable: chargeCapable === true,
            dischargeCapable: dischargeCapable === true,
            fault: batteryFault === true,
            lockout: batteryLockout === true,
            telemetryValid: telemetryValid !== false,
            telemetryStale: telemetryStale === true,
            mappingsReady: telemetryReady === true,
            topOffRequested: topOff,
            ownershipActive: ownershipActive === true,
            deficitChargeActive: chargeLogic.active,
            legacyDeficitChargeActive: false,
            batteryLearning,
            chargeLogic,
            todayPvSurplusKwh: batteryTodayPvSurplusKwh,
        },
        wallbox: {
            now,
            addonEnabled: wallboxEnabled !== false,
            governanceEnabled: wallboxGov,
            globalModeOff,
            addonExecutionOff: (0, execution_mode_1.parseAddonMode)(wallboxModeRaw) === "off",
            modePolicy,
            gridForecast,
            connected: connected === true,
            charging: charging === true,
            vehicleSocPct: vehicleSoc,
            planSocPct: planSoc,
            planActive: planActive === true,
            sessionEnergyKwh: sessionKwh,
            remainingEnergyKwh,
            vehicleCapacityKwh,
            vehicleMaxAcChargePowerW,
            effectiveLimitSocPct: effectiveLimitSoc,
            fallbackTargetSocPct,
            deadlineIso: validIsoDeadline(evFoundation.departureAt) ?? validIsoDeadline(deadlineRaw),
            activePhases,
            maxCurrentA,
            evccConfigured,
            minimumDepartureSocPct: evFoundation.minimumDepartureSocPct,
            departureAt: validIsoDeadline(evFoundation.departureAt),
            chargingEfficiency: evFoundation.chargingEfficiency,
            energyToTargetKwh,
            energyToDepartureMinimumKwh,
            externalSmartChargingMinSocPct: externalMinSocPct,
            externalAuthorityState,
            takeoverSeverity,
            externalSmartPlanJson,
            externalPlanQuality: null,
            loadpointMode: evccLoadpointMode,
            batteryBoost: evccBatteryBoost,
            chargePowerW: evccChargePowerW,
            tibberGridRewardsActive: tibberRewardsRuntime,
        },
        immersion: {
            now,
            addonEnabled: immersionEnabled !== false,
            governanceEnabled: immersionGov,
            globalModeOff,
            addonExecutionOff: (0, execution_mode_1.parseAddonMode)(immersionModeRaw) === "off",
            modePolicy,
            config: immersionConfig,
            bufferTempC: bufferTemp,
            boilerTempC: boilerTemp,
            boilerSensorDegraded,
            thermalMode,
            fault: immersionFault === true,
            lockout: immersionState === "fault_lockout",
            relayMapped,
            pvTodayKwh: pvToday,
            pvTomorrowKwh: pvTomorrow,
            pvBiasStatus,
            forecastModeEnabled: immersionConfig.forecastModeEnabled,
            aiOptimizationAllowed: aiThermal === true,
            thermalLearning,
            boilerLearning,
            hygieneDue: hygiene.due,
            hygieneMandatoryKwh: hygiene.mandatoryEnergyKwh,
            hygieneReasonDe: hygiene.reasonDe,
            autoTargetReached: autoTargetReached === true,
            timezone,
            pvDeficitBridgeUntilIso: chargeLogic.active ? chargeLogic.bridgeUntilIso : null,
            mayUseBatteryForImmersion,
            centralBatteryReserveRequiredSocAtPvEndPct,
            importTariffCtPerKwh,
        },
        airConditioning: {
            now,
            addonEnabled: climateEnabled !== false,
            governanceEnabled: climateGov,
            globalModeOff,
            addonExecutionOff: (0, execution_mode_1.parseAddonMode)(climateModeRaw) === "off",
            modePolicy,
            acConfig,
            outdoorTempC: outdoorTemp,
            outdoorForecastMaxC,
            units: acUnits,
            sharedPowerStats: climateSharedPowerStats,
            hourlyPoints,
            thermalModels,
        },
    });
    return { contributions };
}
exports.collectFlexibleContributions = collectFlexibleContributions;

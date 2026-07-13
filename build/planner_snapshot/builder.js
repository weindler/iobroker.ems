"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachedPlannerSnapshotSource = exports.buildPlannerInputSnapshot = void 0;
const ensure_states_1 = require("../addons/battery/ensure_states");
const intent_read_1 = require("../addons/battery/runtime/intent_read");
const constants_1 = require("../addons/air_conditioning/constants");
const ensure_states_2 = require("../addons/air_conditioning/runtime/ensure_states");
const ensure_states_3 = require("../addons/governance/ensure_states");
const registry_1 = require("../addons/governance/registry");
const intent_read_2 = require("../addons/immersion_heater/runtime/intent_read");
const types_1 = require("../addons/immersion_heater/runtime/types");
const ensure_evcc_states_1 = require("../addons/wallbox/ensure_evcc_states");
const constants_2 = require("../learning/house_load/constants");
const time_1 = require("../learning/house_load/time");
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
const constants_3 = require("../learning/pv_horizon/constants");
const types_2 = require("../learning/consumer_stats/types");
const mode_policy_1 = require("../planner/mode_policy");
const battery_winter_1 = require("../planner/rules/battery_winter");
const tree_paths_1 = require("../tree_paths");
const constants_4 = require("./constants");
const canonical_1 = require("./canonical");
const source_1 = require("./source");
Object.defineProperty(exports, "CachedPlannerSnapshotSource", { enumerable: true, get: function () { return source_1.CachedPlannerSnapshotSource; } });
const time_2 = require("../operator/time");
function policyBool(snapshot, section, key) {
    const entry = snapshot?.[section]?.[key];
    if (!entry || entry.value === null || entry.value === undefined)
        return null;
    return typeof entry.value === "boolean" ? entry.value : null;
}
function policyNumber(snapshot, section, key) {
    const entry = snapshot?.[section]?.[key];
    if (!entry || entry.value === null || entry.value === undefined)
        return null;
    const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
    return Number.isFinite(n) ? n : null;
}
function policyStringArray(snapshot, key) {
    const entry = snapshot?.preferences?.[key];
    if (!entry || !Array.isArray(entry.value))
        return null;
    return entry.value.filter((v) => typeof v === "string");
}
function parsePolicySnapshot(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function parseHouseLoadForecastJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !parsed.segments)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function normalizeHouseLoadForecast(forecast) {
    if (!forecast)
        return null;
    const segments = [];
    for (const [segmentId, entry] of Object.entries(forecast.segments ?? {})) {
        const hours = constants_2.SEGMENT_HOURS[segmentId];
        segments.push({
            segmentId,
            hour: hours?.start ?? 0,
            avgW: entry?.avg_w ?? null,
        });
    }
    segments.sort((a, b) => a.hour - b.hour);
    return {
        dateKey: forecast.date,
        segments,
        dailyKwh: (0, battery_winter_1.dailyKwhFromHouseLoadForecast)(forecast),
    };
}
function validIsoDeadline(raw) {
    if (!raw?.trim())
        return null;
    if (raw.startsWith("0001-01-01T00:00:00"))
        return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function avgLoadKwh(a, b) {
    if (a !== null && b !== null)
        return (a + b) / 2;
    return a ?? b;
}
async function readForeignOrLocalNum(cached, stateId) {
    if (!stateId?.trim())
        return null;
    const foreign = (0, source_1.numValue)(await cached.readForeignState(stateId));
    if (foreign !== null)
        return foreign;
    return (0, source_1.numValue)(await cached.readState(stateId));
}
async function readTibberSlots(cached, now, todayStateId, tomorrowStateId) {
    const minStartMs = now.getTime();
    const byStart = new Map();
    for (const stateId of [todayStateId, tomorrowStateId]) {
        if (!stateId?.trim())
            continue;
        const rawForeign = await cached.readForeignState(stateId);
        let raw = rawForeign.value;
        if (raw === null) {
            raw = (await cached.readState(stateId)).value;
        }
        for (const slot of (0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(raw, { minStartMs })) {
            byStart.set(slot.slotStartMs, {
                slotStartIso: new Date(slot.slotStartMs).toISOString(),
                priceCtPerKwh: slot.priceCtPerKwh,
            });
        }
    }
    return [...byStart.values()].sort((a, b) => a.slotStartIso.localeCompare(b.slotStartIso));
}
function buildPvHorizonDays(now, timezone, correctedToday, correctedTomorrow, pvConfidence, horizonValues, horizonConfidence) {
    const todayKey = (0, time_2.localDateKeyInTimezone)(now, timezone);
    const days = [
        { dayIndex: 0, dateKey: todayKey, correctedKwh: correctedToday, confidencePct: pvConfidence },
        {
            dayIndex: 1,
            dateKey: (0, time_2.addDaysToDateKey)(todayKey, 1),
            correctedKwh: correctedTomorrow,
            confidencePct: pvConfidence,
        },
    ];
    for (let d = constants_3.PV_HORIZON_EXTENDED_FIRST_DAY; d <= constants_3.PV_HORIZON_DAY_COUNT; d++) {
        const idx = d - constants_3.PV_HORIZON_EXTENDED_FIRST_DAY;
        days.push({
            dayIndex: d - 1,
            dateKey: (0, time_2.addDaysToDateKey)(todayKey, d - 1),
            correctedKwh: horizonValues[idx] ?? null,
            confidencePct: horizonConfidence[idx] ?? null,
        });
    }
    return days;
}
function buildBatteryWinterDays(horizonDays, pvToday, pvTomorrow, pvBiasConfidence, loadToday, loadTomorrow, horizonPv, horizonConf) {
    const loadFallback = avgLoadKwh(loadToday, loadTomorrow);
    const days = [];
    for (let i = 0; i < horizonDays; i++) {
        const ctx = (0, time_1.contextForDayOffset)(i);
        let pvKwh = null;
        let pvConfidencePct = null;
        if (i === 0) {
            pvKwh = pvToday;
            pvConfidencePct = pvBiasConfidence;
        }
        else if (i === 1) {
            pvKwh = pvTomorrow;
            pvConfidencePct = pvBiasConfidence !== null ? Math.max(0, pvBiasConfidence - 5) : null;
        }
        else {
            pvKwh = horizonPv[i - 2] ?? null;
            pvConfidencePct = horizonConf[i - 2] ?? null;
        }
        let loadKwh = null;
        if (i === 0)
            loadKwh = loadToday ?? loadFallback;
        else if (i === 1)
            loadKwh = loadTomorrow ?? loadFallback;
        else
            loadKwh = loadFallback;
        days.push({
            dayIndex: i + 1,
            dateKey: ctx.dateKey,
            pvKwh,
            loadKwh,
            pvConfidencePct,
        });
    }
    return days;
}
function thermalRuntimeFromPersist(persist) {
    const base = {
        status: null,
        health: null,
        samples: null,
        runtimeHoursAvg: null,
        runtimeHoursMedian: null,
        coolingRateCPerHAvg: null,
        coolingKPerH: null,
        coolingAsymptoteC: null,
        coolingAsymptoteSource: null,
        currentTemperatureC: null,
        estimatedRemainingHours: null,
        estimatedEmptyAt: null,
        generatedAt: null,
        bySeason: null,
        byDayType: null,
        history: [],
    };
    if (!persist)
        return base;
    return {
        ...base,
        health: persist.health,
        samples: persist.samples,
        runtimeHoursAvg: persist.runtime_hours_avg,
        runtimeHoursMedian: persist.runtime_hours_median,
        coolingRateCPerHAvg: persist.cooling_rate_c_per_h_avg,
        generatedAt: persist.generated_at,
        bySeason: persist.by_season,
        byDayType: persist.by_day_type,
        history: persist.history.map((c) => ({
            startTs: c.startTs,
            endTs: c.endTs,
            startTempC: c.startTempC,
            endTempC: c.endTempC,
            runtimeHours: c.runtimeHours,
            coolingRateCPerH: c.coolingRateCPerH,
            season: c.season,
            dayType: c.dayType,
        })),
    };
}
function runtimeAddonIdForGovernance(id) {
    const entry = registry_1.GOVERNED_ADDON_REGISTRY.find((e) => e.id === id);
    return entry?.runtimeAddonId ?? id;
}
/** Builds a complete planner input snapshot from an abstract source (no adapter). */
async function buildPlannerInputSnapshot(source) {
    const cached = new source_1.CachedPlannerSnapshotSource(source);
    const config = await cached.readConfig();
    const now = cached.now();
    const capturedAt = now.toISOString();
    const timezone = config.timezone;
    const policyRevisionSt = await cached.readState("policy.global.revision");
    const policyStatusSt = await cached.readState("policy.global.status");
    const policyEffectiveRaw = (0, source_1.jsonStringValue)(await cached.readState("policy.global.effective_json"));
    const effectivePolicy = parsePolicySnapshot(policyEffectiveRaw);
    const adminPolicy = config.adminPolicy;
    const policy = {
        revision: (0, source_1.strValue)(policyRevisionSt),
        status: (0, source_1.strValue)(policyStatusSt),
        gridImportAllowed: policyBool(effectivePolicy, "economics", "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
        maxGridImportW: policyNumber(effectivePolicy, "limits", "maxGridImportW") ?? adminPolicy.maxGridImportW,
        houseFuseLimitW: policyNumber(effectivePolicy, "limits", "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
        energyPriority: policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority,
        mutualExclusions: (() => {
            const raw = effectivePolicy?.protection?.mutualExclusions?.value;
            if (Array.isArray(raw)) {
                return raw;
            }
            return adminPolicy.mutualExclusions;
        })(),
    };
    const globalModeRaw = (0, source_1.strValue)(await cached.readState("global_modes.active"));
    const modePolicy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(globalModeRaw);
    const pvFromPv = (0, source_1.numValue)(await cached.readState("live.pv.power_w"));
    const pvFromBattery = (0, source_1.numValue)(await cached.readState("live.battery.pv_ac_power_w"));
    const houseLoadW = (0, source_1.numValue)(await cached.readState("live.battery.house_load_w"));
    const socPctLive = (0, source_1.numValue)(await cached.readState("live.battery.soc_pct"));
    const bufferTempLive = (0, source_1.numValue)(await cached.readState("live.thermal.buffer_temp_c"));
    const currentPrice = (0, source_1.numValue)(await cached.readState("live.price.now_ct_per_kwh"));
    const fixedPrice = (0, source_1.numValue)(await cached.readState("economics.config.fixed_price_ct_per_kwh"));
    const snowCover = (0, source_1.boolValue)(await cached.readState("ems_mirror.snow_cover_suspected"));
    const tempMetric = config.weather.temp;
    const cloudMetric = config.weather.cloud;
    const outdoorTempC = tempMetric
        ? ((await readForeignOrLocalNum(cached, tempMetric.actualStateId)) ??
            (await readForeignOrLocalNum(cached, tempMetric.forecastStateId)))
        : null;
    const cloudPct = cloudMetric
        ? ((await readForeignOrLocalNum(cached, cloudMetric.actualStateId)) ??
            (await readForeignOrLocalNum(cached, cloudMetric.forecastStateId)))
        : null;
    const thermalIntentRaw = (0, source_1.jsonStringValue)(await cached.readState("user_intent.thermal.resolved_json"));
    const thermalIntent = (0, intent_read_2.parseResolvedIntentJson)(thermalIntentRaw);
    const thermalMode = (0, intent_read_2.resolvedModeFromIntent)(thermalIntent);
    const batteryIntentRaw = (0, source_1.jsonStringValue)(await cached.readState("user_intent.battery.resolved_json"));
    const batteryIntent = (0, intent_read_1.parseResolvedBatteryIntentJson)(batteryIntentRaw);
    const batteryHold = batteryIntent?.operating_request.status === "valid" && batteryIntent.operating_request.value === "hold";
    const batteryCharge = batteryIntent?.operating_request.status === "valid" && batteryIntent.operating_request.value === "charge";
    const topOff = batteryIntent?.top_off_requested?.status === "valid" && batteryIntent.top_off_requested.value === true;
    const [pvToday, pvTomorrow, rawToday, rawTomorrow, pvConfidence, pvBiasStatus, pvLastUpdate, houseStatus, houseConfidence, forecastTodayState, forecastTomorrowState, houseLastUpdate, weatherStatus, weatherHealth, weatherConfidence, weatherLastUpdate, weatherForecastSource, weatherActualSource,] = await Promise.all([
        cached.readState("learning.pv_bias.corrected_today_kwh").then(source_1.numValue),
        cached.readState("learning.pv_bias.corrected_tomorrow_kwh").then(source_1.numValue),
        cached.readState("learning.pv_bias.raw_today_kwh").then(source_1.numValue),
        cached.readState("learning.pv_bias.raw_tomorrow_kwh").then(source_1.numValue),
        cached.readState("learning.pv_bias.confidence_pct").then(source_1.numValue),
        cached.readState("learning.pv_bias.status").then(source_1.strValue),
        cached.readState("learning.pv_bias.last_update_ts").then(source_1.strValue),
        cached.readState("learning.house_load.status").then(source_1.strValue),
        cached.readState("learning.house_load.confidence").then(source_1.numValue),
        cached.readState("learning.house_load.forecast_today_json").then(source_1.jsonStringValue),
        cached.readState("learning.house_load.forecast_tomorrow_json").then(source_1.jsonStringValue),
        cached.readState("learning.house_load.last_update").then(source_1.strValue),
        cached.readState("learning.weather.status").then(source_1.strValue),
        cached.readState("learning.weather.health").then(source_1.strValue),
        cached.readState("learning.weather.confidence_pct").then(source_1.numValue),
        cached.readState("learning.weather.last_update").then(source_1.strValue),
        cached.readState("learning.weather.forecast_source").then(source_1.strValue),
        cached.readState("learning.weather.actual_source").then(source_1.strValue),
    ]);
    const horizonValues = await Promise.all(Array.from({ length: constants_3.PV_HORIZON_DAY_COUNT - constants_3.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => cached
        .readState(`learning.pv_horizon.day${constants_3.PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`)
        .then(source_1.numValue)));
    const horizonConfidence = await Promise.all(Array.from({ length: constants_3.PV_HORIZON_DAY_COUNT - constants_3.PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) => cached
        .readState(`learning.pv_horizon.day${constants_3.PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`)
        .then(source_1.numValue)));
    let houseLoadPersist = null;
    if (config.dataPaths.houseLoadLearningDir) {
        houseLoadPersist = await cached.readJsonFile(`${config.dataPaths.houseLoadLearningDir}/house_load_learning_v1.json`);
    }
    const forecastToday = normalizeHouseLoadForecast(houseLoadPersist?.forecast_today ?? null) ??
        normalizeHouseLoadForecast(parseHouseLoadForecastJson(forecastTodayState));
    const forecastTomorrow = normalizeHouseLoadForecast(houseLoadPersist?.forecast_tomorrow ?? null) ??
        normalizeHouseLoadForecast(parseHouseLoadForecastJson(forecastTomorrowState));
    const priceSlots = await readTibberSlots(cached, now, config.priceForecastTodayStateId, config.priceForecastTomorrowStateId);
    const batSoc = (0, source_1.numValue)(await cached.readState(ensure_states_1.BAT.telemetry.socPct));
    const [capacityEffective, capacityNet, capacitySource, minSoc, maxSoc, maxChargeW, chargeCapable, dischargeCapable, batteryFault, batteryLockout, telemetryValid, telemetryStale, telemetryReady, ownershipActive, winterActive,] = await Promise.all([
        cached.readState(ensure_states_1.BAT.telemetry.capacityEffectiveKwh).then(source_1.numValue),
        cached.readState(ensure_states_1.BAT.identity.capacityNetKwh).then(source_1.numValue),
        cached.readState(ensure_states_1.BAT.identity.capacitySource).then(source_1.strValue),
        cached.readState(ensure_states_1.BAT.limits.hardwareMinSocPct).then(source_1.numValue),
        cached.readState(ensure_states_1.BAT.limits.hardwareMaxSocPct).then(source_1.numValue),
        cached.readState(ensure_states_1.BAT.limits.effectiveMaxChargeW).then(source_1.numValue),
        cached.readState(ensure_states_1.BAT.capabilities.setChargePower).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.capabilities.setDischargePower).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.status.fault).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.status.lockout).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.telemetry.valid).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.telemetry.stale).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.status.telemetryReady).then(source_1.boolValue),
        cached.readState(ensure_states_1.BAT.runtime.ownershipActive).then(source_1.boolValue),
        cached.readState("planner.intent.battery.winter.active").then(source_1.boolValue),
    ]);
    const [evccConnected, evccCharging, vehicleSoc, planSoc, planActive, sessionKwh, deadlineRaw, activePhases, maxCurrentA, evccBatteryMode, evccBatteryDischarge,] = await Promise.all([
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected).then(source_1.boolValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging).then(source_1.boolValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct).then(source_1.numValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planSocPct).then(source_1.numValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive).then(source_1.boolValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.sessionEnergyKwh).then(source_1.numValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime).then(source_1.strValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.activePhases).then(source_1.numValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.maxCurrentA).then(source_1.numValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode).then(source_1.strValue),
        cached.readState(ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl).then(source_1.boolValue),
    ]);
    const immersionBuffer = (0, source_1.numValue)(await cached.readState(types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC));
    const immersionFault = (0, source_1.boolValue)(await cached.readState(types_1.IMMERSION_RUNTIME_STATES.faultActive));
    const immersionState = (0, source_1.strValue)(await cached.readState(types_1.IMMERSION_RUNTIME_STATES.state));
    const thermalScalars = await Promise.all([
        cached.readState("learning.thermal_runtime.status").then(source_1.strValue),
        cached.readState("learning.thermal_runtime.health").then(source_1.strValue),
        cached.readState("learning.thermal_runtime.samples").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.runtime_hours_avg").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.runtime_hours_median").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.cooling_rate_c_per_h_avg").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.cooling_k_per_h").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.cooling_asymptote_c").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.cooling_asymptote_source").then(source_1.strValue),
        cached.readState("learning.thermal_runtime.current_temperature_c").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.estimated_remaining_hours").then(source_1.numValue),
        cached.readState("learning.thermal_runtime.estimated_empty_at").then(source_1.strValue),
    ]);
    let thermalPersist = null;
    if (config.dataPaths.thermalRuntimeLearningDir) {
        thermalPersist = await cached.readJsonFile(`${config.dataPaths.thermalRuntimeLearningDir}/thermal_runtime_learning_v1.json`);
    }
    const thermalRuntime = thermalRuntimeFromPersist(thermalPersist);
    thermalRuntime.status = thermalScalars[0];
    thermalRuntime.health = thermalScalars[1] ?? thermalRuntime.health;
    thermalRuntime.samples = thermalScalars[2] ?? thermalRuntime.samples;
    thermalRuntime.runtimeHoursAvg = thermalScalars[3] ?? thermalRuntime.runtimeHoursAvg;
    thermalRuntime.runtimeHoursMedian = thermalScalars[4] ?? thermalRuntime.runtimeHoursMedian;
    thermalRuntime.coolingRateCPerHAvg = thermalScalars[5] ?? thermalRuntime.coolingRateCPerHAvg;
    thermalRuntime.coolingKPerH = thermalScalars[6];
    thermalRuntime.coolingAsymptoteC = thermalScalars[7];
    thermalRuntime.coolingAsymptoteSource = thermalScalars[8];
    thermalRuntime.currentTemperatureC = thermalScalars[9] ?? thermalRuntime.currentTemperatureC;
    thermalRuntime.estimatedRemainingHours = thermalScalars[10];
    thermalRuntime.estimatedEmptyAt = thermalScalars[11];
    let consumerStats = null;
    if (config.dataPaths.consumerStatsDir) {
        consumerStats = await cached.readJsonFile(`${config.dataPaths.consumerStatsDir}/${types_2.CONSUMER_STATS_FILENAME}`);
    }
    const consumerStatEntries = consumerStats
        ? Object.entries(consumerStats.consumers ?? {}).map(([consumerKey, row]) => ({
            consumerKey,
            totalRuntimeSec: row?.totalRuntimeSec ?? null,
            totalEnergyKwh: row?.totalEnergyKwh ?? null,
            todayRuntimeSec: row?.todayRuntimeSec ?? null,
            todayEnergyKwh: row?.todayEnergyKwh ?? null,
            sessionRuntimeSec: row?.sessionRuntimeSec ?? null,
            sessionEnergyKwh: row?.sessionEnergyKwh ?? null,
        }))
        : [];
    const governanceAddons = [];
    for (const entry of registry_1.GOVERNED_ADDON_REGISTRY) {
        const runtimeId = runtimeAddonIdForGovernance(entry.id);
        const [addonEn, govEn, aiAllowed] = await Promise.all([
            cached.readState((0, tree_paths_1.addonEnabled)(runtimeId)).then(source_1.boolValue),
            cached.readState((0, ensure_states_3.addonGovernanceEnabledState)(entry.id)).then(source_1.boolValue),
            cached.readState((0, ensure_states_3.addonGovernanceAiAllowedState)(entry.id)).then(source_1.boolValue),
        ]);
        governanceAddons.push({
            addonId: entry.id,
            enabled: addonEn,
            governanceEnabled: govEn,
            aiAllowed: aiAllowed,
        });
    }
    const acUnits = [];
    for (const unit of config.acUnits) {
        if (!unit.enabled)
            continue;
        const ids = (0, ensure_states_2.acUnitRuntimeStates)(unit.index);
        const [roomTempC, state, cleaningActive] = await Promise.all([
            cached.readState(ids.roomTempC).then(source_1.numValue),
            cached.readState(ids.state).then(source_1.strValue),
            cached.readState(ids.cleaningActive).then(source_1.boolValue),
        ]);
        const consumerKey = (0, constants_1.acUnitConsumerKey)(unit.index);
        acUnits.push({
            index: unit.index,
            enabled: true,
            roomTempC,
            targetTempC: unit.targetTempC,
            state,
            cleaningActive,
            consumerKey,
            learnedPowerW: null,
        });
    }
    const loadTodayKwh = forecastToday?.dailyKwh ?? null;
    const loadTomorrowKwh = forecastTomorrow?.dailyKwh ?? null;
    const batteryWinterDays = buildBatteryWinterDays(config.batteryWinter.horizonDays, pvToday, pvTomorrow, pvConfidence, loadTodayKwh, loadTomorrowKwh, horizonValues, horizonConfidence);
    const withoutRevision = {
        schemaVersion: constants_4.PLANNER_INPUT_SCHEMA_VERSION,
        capturedAt,
        timezone,
        sourceRevision: null,
        general: {
            globalMode: modePolicy.mode,
            executionMode: config.executionMode,
            globalModePolicyLabel: modePolicy.labelDe,
            snowCoverSuspected: snowCover,
        },
        policy,
        live: {
            pvPowerW: pvFromPv ?? pvFromBattery,
            houseLoadW,
            socPct: socPctLive,
            bufferTempC: bufferTempLive,
            outdoorTempC,
            cloudPct,
            currentPriceCtPerKwh: currentPrice,
            fixedPriceCtPerKwh: fixedPrice,
        },
        learning: {
            pvBias: {
                correctedTodayKwh: pvToday,
                correctedTomorrowKwh: pvTomorrow,
                rawTodayKwh: rawToday,
                rawTomorrowKwh: rawTomorrow,
                confidencePct: pvConfidence,
                status: pvBiasStatus,
                lastUpdateTs: pvLastUpdate,
            },
            pvHorizon: buildPvHorizonDays(now, timezone, pvToday, pvTomorrow, pvConfidence, horizonValues, horizonConfidence),
            houseLoad: {
                status: houseLoadPersist?.health?.status ?? houseStatus,
                confidence: houseLoadPersist?.confidence ?? houseConfidence,
                lastUpdate: houseLoadPersist?.generated_at ?? houseLastUpdate,
                forecastToday,
                forecastTomorrow,
            },
            weather: {
                status: weatherStatus,
                health: weatherHealth,
                confidencePct: weatherConfidence,
                lastUpdate: weatherLastUpdate,
                forecastSource: weatherForecastSource,
                actualSource: weatherActualSource,
            },
            thermalRuntime,
        },
        prices: { slots15Min: priceSlots },
        intents: {
            thermal: {
                mode: thermalMode,
                operatingRequestStatus: thermalIntent?.operating_request?.status ?? null,
            },
            battery: {
                operatingRequest: batteryIntent?.operating_request?.status === "valid"
                    ? batteryIntent.operating_request.value
                    : null,
                operatingRequestStatus: batteryIntent?.operating_request?.status ?? null,
                topOffRequested: topOff,
                hold: batteryHold,
                charge: batteryCharge,
            },
        },
        battery: {
            socPct: batSoc,
            capacityEffectiveKwh: capacityEffective,
            capacityNetKwh: capacityNet,
            capacitySource,
            minSocPct: minSoc,
            maxSocPct: maxSoc,
            maxChargeW,
            chargeCapable,
            dischargeCapable,
            fault: batteryFault,
            lockout: batteryLockout,
            telemetryValid,
            telemetryStale,
            telemetryReady,
            ownershipActive,
            winterGridActive: winterActive,
        },
        wallbox: {
            connected: evccConnected,
            charging: evccCharging,
            vehicleSocPct: vehicleSoc,
            planSocPct: planSoc,
            planActive,
            sessionEnergyKwh: sessionKwh,
            deadlineIso: validIsoDeadline(deadlineRaw),
            activePhases,
            maxCurrentA,
            evccConfigured: (config.wallboxEvccEnabledStateId?.trim().length ?? 0) > 0,
            batteryMode: evccBatteryMode,
            batteryDischargeControl: evccBatteryDischarge,
        },
        thermal: {
            bufferTempC: immersionBuffer ?? bufferTempLive,
            runtimeState: immersionState,
            faultActive: immersionFault,
            config: {
                forecastModeEnabled: config.immersion.forecastModeEnabled,
                planningMaxTempC: config.immersion.planningMaxTempC,
                stages: config.immersion.stages.map((s) => ({
                    index: s.index,
                    enabled: s.enabled,
                    nominalPowerW: s.nominalPowerW,
                    label: s.label,
                })),
                minRuntimeMin: config.immersion.minRuntimeMin,
                minPauseMin: config.immersion.minPauseMin,
            },
        },
        airConditioning: { units: acUnits },
        governance: { addons: governanceAddons },
        consumerStats: consumerStatEntries,
        batteryWinter: {
            config: config.batteryWinter,
            days: batteryWinterDays,
        },
    };
    const sourceRevision = (0, canonical_1.computeSourceRevision)([
        policy.revision,
        pvLastUpdate,
        houseLastUpdate,
        weatherLastUpdate,
        thermalRuntime.generatedAt,
    ]);
    const draft = { ...withoutRevision, sourceRevision, inputRevision: "" };
    const inputRevision = (0, canonical_1.computeInputRevision)(draft);
    return { ...draft, inputRevision };
}
exports.buildPlannerInputSnapshot = buildPlannerInputSnapshot;

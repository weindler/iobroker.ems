import { BAT } from "../addons/battery/ensure_states";
import { parseResolvedBatteryIntentJson } from "../addons/battery/runtime/intent_read";
import { acUnitConsumerKey } from "../addons/air_conditioning/constants";
import { acUnitRuntimeStates } from "../addons/air_conditioning/runtime/ensure_states";
import {
	addonGovernanceAiAllowedState,
	addonGovernanceEnabledState,
} from "../addons/governance/ensure_states";
import { GOVERNED_ADDON_REGISTRY } from "../addons/governance/registry";
import type { GovernedAddonId } from "../addons/governance/types";
import { parseResolvedIntentJson, resolvedModeFromIntent } from "../addons/immersion_heater/runtime/intent_read";
import { IMMERSION_RUNTIME_STATES } from "../addons/immersion_heater/runtime/types";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states";
import type { DayForecastJson } from "../learning/house_load/types";
import { SEGMENT_HOURS, type HouseLoadSegment } from "../learning/house_load/constants";
import type { HouseLoadPersist } from "../learning/house_load/types";
import { contextForDayOffset } from "../learning/house_load/time";
import { parseTibberPriceJsonTo15MinSlots } from "../learning/price_forecast/tibber_parse";
import { PV_HORIZON_DAY_COUNT, PV_HORIZON_EXTENDED_FIRST_DAY } from "../learning/pv_horizon/constants";
import type { ThermalRuntimePersist } from "../learning/thermal_runtime/types";
import type { ConsumerStatsPersist } from "../learning/consumer_stats/types";
import { CONSUMER_STATS_FILENAME } from "../learning/consumer_stats/types";
import { plannerModePolicyFromGlobalMode } from "../planner/mode_policy";
import { dailyKwhFromHouseLoadForecast } from "../planner/rules/battery_winter";
import { addonEnabled } from "../tree_paths";
import { PLANNER_INPUT_SCHEMA_VERSION } from "./constants";
import { computeInputRevision, computeSourceRevision } from "./canonical";
import {
	boolValue,
	CachedPlannerSnapshotSource,
	jsonStringValue,
	numValue,
	strValue,
	type PlannerSnapshotSource,
} from "./source";
import type {
	PlannerInputSnapshot,
	SnapshotAcUnit,
	SnapshotBatteryWinterDay,
	SnapshotConsumerStatEntry,
	SnapshotGovernanceAddon,
	SnapshotHouseLoadDayForecast,
	SnapshotHouseLoadSegment,
	SnapshotPriceSlot15Min,
	SnapshotPvHorizonDay,
	SnapshotThermalRuntimeLearning,
} from "./types";
import { addDaysToDateKey, localDateKeyInTimezone } from "../operator/time";

type PolicySnapshotShape = {
	economics?: Record<string, { value?: unknown }>;
	limits?: Record<string, { value?: unknown }>;
	preferences?: Record<string, { value?: unknown }>;
	protection?: { mutualExclusions?: { value?: unknown } };
};

function policyBool(snapshot: PolicySnapshotShape | null, section: "economics", key: string): boolean | null {
	const entry = snapshot?.[section]?.[key];
	if (!entry || entry.value === null || entry.value === undefined) return null;
	return typeof entry.value === "boolean" ? entry.value : null;
}

function policyNumber(snapshot: PolicySnapshotShape | null, section: "limits", key: string): number | null {
	const entry = snapshot?.[section]?.[key];
	if (!entry || entry.value === null || entry.value === undefined) return null;
	const n = typeof entry.value === "number" ? entry.value : parseFloat(String(entry.value));
	return Number.isFinite(n) ? n : null;
}

function policyStringArray(snapshot: PolicySnapshotShape | null, key: string): string[] | null {
	const entry = snapshot?.preferences?.[key];
	if (!entry || !Array.isArray(entry.value)) return null;
	return entry.value.filter((v): v is string => typeof v === "string");
}

function parsePolicySnapshot(raw: string | null): PolicySnapshotShape | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as PolicySnapshotShape;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

function parseHouseLoadForecastJson(raw: string | null): DayForecastJson | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as DayForecastJson;
		if (!parsed || typeof parsed !== "object" || !parsed.segments) return null;
		return parsed;
	} catch {
		return null;
	}
}

function normalizeHouseLoadForecast(forecast: DayForecastJson | null): SnapshotHouseLoadDayForecast | null {
	if (!forecast) return null;
	const segments: SnapshotHouseLoadSegment[] = [];
	for (const [segmentId, entry] of Object.entries(forecast.segments ?? {})) {
		const hours = SEGMENT_HOURS[segmentId as HouseLoadSegment];
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
		dailyKwh: dailyKwhFromHouseLoadForecast(forecast),
	};
}

function validIsoDeadline(raw: string | null): string | null {
	if (!raw?.trim()) return null;
	if (raw.startsWith("0001-01-01T00:00:00")) return null;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function avgLoadKwh(a: number | null, b: number | null): number | null {
	if (a !== null && b !== null) return (a + b) / 2;
	return a ?? b;
}

async function readForeignOrLocalNum(
	cached: CachedPlannerSnapshotSource,
	stateId: string | null | undefined,
): Promise<number | null> {
	if (!stateId?.trim()) return null;
	const foreign = numValue(await cached.readForeignState(stateId));
	if (foreign !== null) return foreign;
	return numValue(await cached.readState(stateId));
}

async function readTibberSlots(
	cached: CachedPlannerSnapshotSource,
	now: Date,
	todayStateId: string | null,
	tomorrowStateId: string | null,
): Promise<SnapshotPriceSlot15Min[]> {
	const minStartMs = now.getTime();
	const byStart = new Map<number, SnapshotPriceSlot15Min>();
	for (const stateId of [todayStateId, tomorrowStateId]) {
		if (!stateId?.trim()) continue;
		const rawForeign = await cached.readForeignState(stateId);
		let raw: unknown = rawForeign.value;
		if (raw === null) {
			raw = (await cached.readState(stateId)).value;
		}
		for (const slot of parseTibberPriceJsonTo15MinSlots(raw, { minStartMs })) {
			byStart.set(slot.slotStartMs, {
				slotStartIso: new Date(slot.slotStartMs).toISOString(),
				priceCtPerKwh: slot.priceCtPerKwh,
			});
		}
	}
	return [...byStart.values()].sort((a, b) => a.slotStartIso.localeCompare(b.slotStartIso));
}

function buildPvHorizonDays(
	now: Date,
	timezone: string,
	correctedToday: number | null,
	correctedTomorrow: number | null,
	pvConfidence: number | null,
	horizonValues: Array<number | null>,
	horizonConfidence: Array<number | null>,
): SnapshotPvHorizonDay[] {
	const todayKey = localDateKeyInTimezone(now, timezone);
	const days: SnapshotPvHorizonDay[] = [
		{ dayIndex: 0, dateKey: todayKey, correctedKwh: correctedToday, confidencePct: pvConfidence },
		{
			dayIndex: 1,
			dateKey: addDaysToDateKey(todayKey, 1),
			correctedKwh: correctedTomorrow,
			confidencePct: pvConfidence,
		},
	];
	for (let d = PV_HORIZON_EXTENDED_FIRST_DAY; d <= PV_HORIZON_DAY_COUNT; d++) {
		const idx = d - PV_HORIZON_EXTENDED_FIRST_DAY;
		days.push({
			dayIndex: d - 1,
			dateKey: addDaysToDateKey(todayKey, d - 1),
			correctedKwh: horizonValues[idx] ?? null,
			confidencePct: horizonConfidence[idx] ?? null,
		});
	}
	return days;
}

function buildBatteryWinterDays(
	horizonDays: number,
	pvToday: number | null,
	pvTomorrow: number | null,
	pvBiasConfidence: number | null,
	loadToday: number | null,
	loadTomorrow: number | null,
	horizonPv: Array<number | null>,
	horizonConf: Array<number | null>,
): SnapshotBatteryWinterDay[] {
	const loadFallback = avgLoadKwh(loadToday, loadTomorrow);
	const days: SnapshotBatteryWinterDay[] = [];
	for (let i = 0; i < horizonDays; i++) {
		const ctx = contextForDayOffset(i);
		let pvKwh: number | null = null;
		let pvConfidencePct: number | null = null;
		if (i === 0) {
			pvKwh = pvToday;
			pvConfidencePct = pvBiasConfidence;
		} else if (i === 1) {
			pvKwh = pvTomorrow;
			pvConfidencePct = pvBiasConfidence !== null ? Math.max(0, pvBiasConfidence - 5) : null;
		} else {
			pvKwh = horizonPv[i - 2] ?? null;
			pvConfidencePct = horizonConf[i - 2] ?? null;
		}
		let loadKwh: number | null = null;
		if (i === 0) loadKwh = loadToday ?? loadFallback;
		else if (i === 1) loadKwh = loadTomorrow ?? loadFallback;
		else loadKwh = loadFallback;
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

function thermalRuntimeFromPersist(persist: ThermalRuntimePersist | null): SnapshotThermalRuntimeLearning {
	const base: SnapshotThermalRuntimeLearning = {
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
	if (!persist) return base;
	return {
		...base,
		health: persist.health,
		samples: persist.samples,
		runtimeHoursAvg: persist.runtime_hours_avg,
		runtimeHoursMedian: persist.runtime_hours_median,
		coolingRateCPerHAvg: persist.cooling_rate_c_per_h_avg,
		generatedAt: persist.generated_at,
		bySeason: persist.by_season as SnapshotThermalRuntimeLearning["bySeason"],
		byDayType: persist.by_day_type as SnapshotThermalRuntimeLearning["byDayType"],
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

function runtimeAddonIdForGovernance(id: GovernedAddonId): string {
	const entry = GOVERNED_ADDON_REGISTRY.find((e) => e.id === id);
	return entry?.runtimeAddonId ?? id;
}

/** Builds a complete planner input snapshot from an abstract source (no adapter). */
export async function buildPlannerInputSnapshot(source: PlannerSnapshotSource): Promise<PlannerInputSnapshot> {
	const cached = new CachedPlannerSnapshotSource(source);
	const config = await cached.readConfig();
	const now = cached.now();
	const capturedAt = now.toISOString();
	const timezone = config.timezone;

	const policyRevisionSt = await cached.readState("policy.global.revision");
	const policyStatusSt = await cached.readState("policy.global.status");
	const policyEffectiveRaw = jsonStringValue(await cached.readState("policy.global.effective_json"));
	const effectivePolicy = parsePolicySnapshot(policyEffectiveRaw);

	const adminPolicy = config.adminPolicy;
	const policy = {
		revision: strValue(policyRevisionSt),
		status: strValue(policyStatusSt),
		gridImportAllowed:
			policyBool(effectivePolicy, "economics", "gridImportAllowed") ?? adminPolicy.gridImportAllowed,
		maxGridImportW:
			policyNumber(effectivePolicy, "limits", "maxGridImportW") ?? adminPolicy.maxGridImportW,
		houseFuseLimitW:
			policyNumber(effectivePolicy, "limits", "houseFuseLimitW") ?? adminPolicy.houseFuseLimitW,
		energyPriority: policyStringArray(effectivePolicy, "energyPriority") ?? adminPolicy.energyPriority,
		mutualExclusions: (() => {
			const raw = effectivePolicy?.protection?.mutualExclusions?.value;
			if (Array.isArray(raw)) {
				return raw as Array<{ id: string; addonA: string; addonB: string; reason?: string }>;
			}
			return adminPolicy.mutualExclusions;
		})(),
	};

	const globalModeRaw = strValue(await cached.readState("global_modes.active"));
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);

	const pvFromPv = numValue(await cached.readState("live.pv.power_w"));
	const pvFromBattery = numValue(await cached.readState("live.battery.pv_ac_power_w"));
	const houseLoadW = numValue(await cached.readState("live.battery.house_load_w"));
	const socPctLive = numValue(await cached.readState("live.battery.soc_pct"));
	const bufferTempLive = numValue(await cached.readState("live.thermal.buffer_temp_c"));
	const currentPrice = numValue(await cached.readState("live.price.now_ct_per_kwh"));
	const fixedPrice = numValue(await cached.readState("economics.config.fixed_price_ct_per_kwh"));
	const snowCover = boolValue(await cached.readState("ems_mirror.snow_cover_suspected"));

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

	const thermalIntentRaw = jsonStringValue(await cached.readState("user_intent.thermal.resolved_json"));
	const thermalIntent = parseResolvedIntentJson(thermalIntentRaw);
	const thermalMode = resolvedModeFromIntent(thermalIntent);

	const batteryIntentRaw = jsonStringValue(await cached.readState("user_intent.battery.resolved_json"));
	const batteryIntent = parseResolvedBatteryIntentJson(batteryIntentRaw);
	const batteryHold =
		batteryIntent?.operating_request.status === "valid" && batteryIntent.operating_request.value === "hold";
	const batteryCharge =
		batteryIntent?.operating_request.status === "valid" && batteryIntent.operating_request.value === "charge";
	const topOff =
		batteryIntent?.top_off_requested?.status === "valid" && batteryIntent.top_off_requested.value === true;

	const [
		pvToday,
		pvTomorrow,
		rawToday,
		rawTomorrow,
		pvConfidence,
		pvBiasStatus,
		pvLastUpdate,
		houseStatus,
		houseConfidence,
		forecastTodayState,
		forecastTomorrowState,
		houseLastUpdate,
		weatherStatus,
		weatherHealth,
		weatherConfidence,
		weatherLastUpdate,
		weatherForecastSource,
		weatherActualSource,
	] = await Promise.all([
		cached.readState("learning.pv_bias.corrected_today_kwh").then(numValue),
		cached.readState("learning.pv_bias.corrected_tomorrow_kwh").then(numValue),
		cached.readState("learning.pv_bias.raw_today_kwh").then(numValue),
		cached.readState("learning.pv_bias.raw_tomorrow_kwh").then(numValue),
		cached.readState("learning.pv_bias.confidence_pct").then(numValue),
		cached.readState("learning.pv_bias.status").then(strValue),
		cached.readState("learning.pv_bias.last_update_ts").then(strValue),
		cached.readState("learning.house_load.status").then(strValue),
		cached.readState("learning.house_load.confidence").then(numValue),
		cached.readState("learning.house_load.forecast_today_json").then(jsonStringValue),
		cached.readState("learning.house_load.forecast_tomorrow_json").then(jsonStringValue),
		cached.readState("learning.house_load.last_update").then(strValue),
		cached.readState("learning.weather.status").then(strValue),
		cached.readState("learning.weather.health").then(strValue),
		cached.readState("learning.weather.confidence_pct").then(numValue),
		cached.readState("learning.weather.last_update").then(strValue),
		cached.readState("learning.weather.forecast_source").then(strValue),
		cached.readState("learning.weather.actual_source").then(strValue),
	]);

	const horizonValues = await Promise.all(
		Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
			cached
				.readState(`learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`)
				.then(numValue),
		),
	);
	const horizonConfidence = await Promise.all(
		Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
			cached
				.readState(`learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`)
				.then(numValue),
		),
	);

	let houseLoadPersist: HouseLoadPersist | null = null;
	if (config.dataPaths.houseLoadLearningDir) {
		houseLoadPersist = await cached.readJsonFile<HouseLoadPersist>(
			`${config.dataPaths.houseLoadLearningDir}/house_load_learning_v1.json`,
		);
	}
	const forecastToday =
		normalizeHouseLoadForecast(houseLoadPersist?.forecast_today ?? null) ??
		normalizeHouseLoadForecast(parseHouseLoadForecastJson(forecastTodayState));
	const forecastTomorrow =
		normalizeHouseLoadForecast(houseLoadPersist?.forecast_tomorrow ?? null) ??
		normalizeHouseLoadForecast(parseHouseLoadForecastJson(forecastTomorrowState));

	const priceSlots = await readTibberSlots(
		cached,
		now,
		config.priceForecastTodayStateId,
		config.priceForecastTomorrowStateId,
	);

	const batSoc = numValue(await cached.readState(BAT.telemetry.socPct));
	const [
		capacityEffective,
		capacityNet,
		capacitySource,
		minSoc,
		maxSoc,
		maxChargeW,
		chargeCapable,
		dischargeCapable,
		batteryFault,
		batteryLockout,
		telemetryValid,
		telemetryStale,
		telemetryReady,
		ownershipActive,
		winterActive,
	] = await Promise.all([
		cached.readState(BAT.telemetry.capacityEffectiveKwh).then(numValue),
		cached.readState(BAT.identity.capacityNetKwh).then(numValue),
		cached.readState(BAT.identity.capacitySource).then(strValue),
		cached.readState(BAT.limits.hardwareMinSocPct).then(numValue),
		cached.readState(BAT.limits.hardwareMaxSocPct).then(numValue),
		cached.readState(BAT.limits.effectiveMaxChargeW).then(numValue),
		cached.readState(BAT.capabilities.setChargePower).then(boolValue),
		cached.readState(BAT.capabilities.setDischargePower).then(boolValue),
		cached.readState(BAT.status.fault).then(boolValue),
		cached.readState(BAT.status.lockout).then(boolValue),
		cached.readState(BAT.telemetry.valid).then(boolValue),
		cached.readState(BAT.telemetry.stale).then(boolValue),
		cached.readState(BAT.status.telemetryReady).then(boolValue),
		cached.readState(BAT.runtime.ownershipActive).then(boolValue),
		cached.readState("planner.intent.battery.winter.active").then(boolValue),
	]);

	const [
		evccConnected,
		evccCharging,
		vehicleSoc,
		planSoc,
		planActive,
		sessionKwh,
		deadlineRaw,
		activePhases,
		maxCurrentA,
		evccBatteryMode,
		evccBatteryDischarge,
	] = await Promise.all([
		cached.readState(WALLBOX_EVCC_STATES.connected).then(boolValue),
		cached.readState(WALLBOX_EVCC_STATES.charging).then(boolValue),
		cached.readState(WALLBOX_EVCC_STATES.vehicleSocPct).then(numValue),
		cached.readState(WALLBOX_EVCC_STATES.planSocPct).then(numValue),
		cached.readState(WALLBOX_EVCC_STATES.planActive).then(boolValue),
		cached.readState(WALLBOX_EVCC_STATES.sessionEnergyKwh).then(numValue),
		cached.readState(WALLBOX_EVCC_STATES.effectivePlanTime).then(strValue),
		cached.readState(WALLBOX_EVCC_STATES.activePhases).then(numValue),
		cached.readState(WALLBOX_EVCC_STATES.maxCurrentA).then(numValue),
		cached.readState(WALLBOX_EVCC_STATES.batteryMode).then(strValue),
		cached.readState(WALLBOX_EVCC_STATES.batteryDischargeControl).then(boolValue),
	]);

	const immersionBuffer = numValue(await cached.readState(IMMERSION_RUNTIME_STATES.bufferTemperatureC));
	const immersionFault = boolValue(await cached.readState(IMMERSION_RUNTIME_STATES.faultActive));
	const immersionState = strValue(await cached.readState(IMMERSION_RUNTIME_STATES.state));

	const thermalScalars = await Promise.all([
		cached.readState("learning.thermal_runtime.status").then(strValue),
		cached.readState("learning.thermal_runtime.health").then(strValue),
		cached.readState("learning.thermal_runtime.samples").then(numValue),
		cached.readState("learning.thermal_runtime.runtime_hours_avg").then(numValue),
		cached.readState("learning.thermal_runtime.runtime_hours_median").then(numValue),
		cached.readState("learning.thermal_runtime.cooling_rate_c_per_h_avg").then(numValue),
		cached.readState("learning.thermal_runtime.cooling_k_per_h").then(numValue),
		cached.readState("learning.thermal_runtime.cooling_asymptote_c").then(numValue),
		cached.readState("learning.thermal_runtime.cooling_asymptote_source").then(strValue),
		cached.readState("learning.thermal_runtime.current_temperature_c").then(numValue),
		cached.readState("learning.thermal_runtime.estimated_remaining_hours").then(numValue),
		cached.readState("learning.thermal_runtime.estimated_empty_at").then(strValue),
	]);

	let thermalPersist: ThermalRuntimePersist | null = null;
	if (config.dataPaths.thermalRuntimeLearningDir) {
		thermalPersist = await cached.readJsonFile<ThermalRuntimePersist>(
			`${config.dataPaths.thermalRuntimeLearningDir}/thermal_runtime_learning_v1.json`,
		);
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

	let consumerStats: ConsumerStatsPersist | null = null;
	if (config.dataPaths.consumerStatsDir) {
		consumerStats = await cached.readJsonFile<ConsumerStatsPersist>(
			`${config.dataPaths.consumerStatsDir}/${CONSUMER_STATS_FILENAME}`,
		);
	}
	const consumerStatEntries: SnapshotConsumerStatEntry[] = consumerStats
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

	const governanceAddons: SnapshotGovernanceAddon[] = [];
	for (const entry of GOVERNED_ADDON_REGISTRY) {
		const runtimeId = runtimeAddonIdForGovernance(entry.id);
		const [addonEn, govEn, aiAllowed] = await Promise.all([
			cached.readState(addonEnabled(runtimeId)).then(boolValue),
			cached.readState(addonGovernanceEnabledState(entry.id)).then(boolValue),
			cached.readState(addonGovernanceAiAllowedState(entry.id)).then(boolValue),
		]);
		governanceAddons.push({
			addonId: entry.id,
			enabled: addonEn,
			governanceEnabled: govEn,
			aiAllowed: aiAllowed,
		});
	}

	const acUnits: SnapshotAcUnit[] = [];
	for (const unit of config.acUnits) {
		if (!unit.enabled) continue;
		const ids = acUnitRuntimeStates(unit.index);
		const [roomTempC, state, cleaningActive] = await Promise.all([
			cached.readState(ids.roomTempC).then(numValue),
			cached.readState(ids.state).then(strValue),
			cached.readState(ids.cleaningActive).then(boolValue),
		]);
		const consumerKey = acUnitConsumerKey(unit.index);
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
	const batteryWinterDays = buildBatteryWinterDays(
		config.batteryWinter.horizonDays,
		pvToday,
		pvTomorrow,
		pvConfidence,
		loadTodayKwh,
		loadTomorrowKwh,
		horizonValues,
		horizonConfidence,
	);

	const withoutRevision: Omit<PlannerInputSnapshot, "inputRevision"> = {
		schemaVersion: PLANNER_INPUT_SCHEMA_VERSION,
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
			pvHorizon: buildPvHorizonDays(
				now,
				timezone,
				pvToday,
				pvTomorrow,
				pvConfidence,
				horizonValues,
				horizonConfidence,
			),
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
				operatingRequest:
					batteryIntent?.operating_request?.status === "valid"
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

	const sourceRevision = computeSourceRevision([
		policy.revision,
		pvLastUpdate,
		houseLastUpdate,
		weatherLastUpdate,
		thermalRuntime.generatedAt,
	]);
	const draft: PlannerInputSnapshot = { ...withoutRevision, sourceRevision, inputRevision: "" };
	const inputRevision = computeInputRevision(draft);
	return { ...draft, inputRevision };
}

export { CachedPlannerSnapshotSource };

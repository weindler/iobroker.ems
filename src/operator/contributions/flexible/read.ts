import { asNum } from "../../../ems_light/state_util";
import type { StateHost } from "../../../ems_light/state_util";
import { batteryConfigFromAdapter, batteryProfileIdFromConfig } from "../../../addons/battery/config";
import { BAT } from "../../../addons/battery/ensure_states";
import { parseResolvedBatteryIntentJson } from "../../../addons/battery/runtime/intent_read";
import { WALLBOX_EVCC_STATES } from "../../../addons/wallbox/ensure_evcc_states";
import { WALLBOX_RUNTIME_STATES } from "../../../addons/wallbox/runtime/states";
import { wallboxEvccTelemetryConfigFromAdapter } from "../../../addons/wallbox/evcc_config";
import {
	lookupVehicleMapEntry,
	wallboxVehicleMapFromAdapter,
} from "../../../addons/wallbox/vehicle_map";
import { intentEvccConfigFromAdapter } from "../../../intent/config";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { IMMERSION_RUNTIME_STATES } from "../../../addons/immersion_heater/runtime/types";
import { acGlobalConfigFromAdapter } from "../../../addons/air_conditioning/config";
import { AC_UNIT_COUNT, acUnitConsumerKey } from "../../../addons/air_conditioning/constants";
import { acUnitRuntimeStates } from "../../../addons/air_conditioning/runtime/ensure_states";
import { isAddonGovernanceEnabledFromState } from "../../../addons/governance";
import { addonGovernanceAiAllowedState } from "../../../addons/governance/ensure_states";
import { weatherConfigFromAdapter } from "../../../learning/weather/config";
import { PERSIST_CATEGORY as CONSUMER_STATS_PERSIST } from "../../../learning/consumer_stats";
import { readConsumerStatsPersist } from "../../../learning/consumer_stats/persist";
import type { ConsumerStatsPersist } from "../../../learning/consumer_stats/types";
import { PV_HORIZON_DAY_COUNT, PV_HORIZON_EXTENDED_FIRST_DAY } from "../../../learning/pv_horizon/constants";
import { addonEnabled } from "../../../tree_paths";
import { plannerModePolicyFromGlobalMode, type PlannerModePolicy } from "../../../planner/mode_policy";
import { parseResolvedIntentJson, resolvedModeFromIntent } from "../../../addons/immersion_heater/runtime/intent_read";
import type { GridSupplyForecast } from "../../types";
import type { PlanContribution } from "../../types";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../time";
import { intentAdminConfigFromAdapter } from "../../../intent/config";
import { dailyKwhFromHouseLoadDayForecast } from "../house_load";
import { parseHouseLoadForecastHorizonJson, parseHouseLoadForecastJson, type ContributionsReadHost } from "../read";
import { buildFlexibleContributions } from "./build";
import {
	planBatteryChargeLogic,
	type BatteryChargeLogicDayInput,
	type BatteryChargeLogicDecision,
} from "./battery_charge_logic";
import { batteryChargeLogicConfigFromAdapter } from "./battery_charge_logic_config";
import { todayPvSurplusKwh } from "./battery_pv_cover";
import { buildBatteryLearningSignal, type BatteryLearningSignal } from "./battery_learning";
import { buildThermalLearningSignal, type ThermalLearningSignal } from "./thermal_learning";

export type FlexibleContributionsReadHost = ContributionsReadHost & {
	getAbsolutePath?: (rel: string) => string;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

async function readNum(host: StateHost, relId: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(relId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readBool(host: StateHost, relId: string): Promise<boolean | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val === true || st?.val === false) return st.val;
		if (st?.val === 1 || st?.val === "1" || st?.val === "true") return true;
		if (st?.val === 0 || st?.val === "0" || st?.val === "false") return false;
		return null;
	} catch {
		return null;
	}
}

async function readStr(host: StateHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readConsumerStats(host: FlexibleContributionsReadHost): Promise<ConsumerStatsPersist | null> {
	const dir = host.getAbsolutePath?.(CONSUMER_STATS_PERSIST);
	if (!dir) return null;
	try {
		return await readConsumerStatsPersist(dir);
	} catch {
		return null;
	}
}

async function readOutdoorTempC(host: FlexibleContributionsReadHost): Promise<number | null> {
	const weather = weatherConfigFromAdapter(host.config);
	const tempMetric = weather.metrics.temp;
	if (!tempMetric) return null;
	const actual = tempMetric.actualStateId
		? await readForeignNum(host, tempMetric.actualStateId)
		: null;
	if (actual !== null) return actual;
	return tempMetric.forecastStateId ? readForeignNum(host, tempMetric.forecastStateId) : null;
}

async function readForeignNum(host: FlexibleContributionsReadHost, stateId: string): Promise<number | null> {
	if (!stateId.trim()) return null;
	try {
		const st = await host.getForeignStateAsync?.(stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

function validIsoDeadline(raw: string | null): string | null {
	if (!raw?.trim()) return null;
	if (raw.startsWith("0001-01-01T00:00:00")) return null;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function readThermalLearningSignal(
	host: FlexibleContributionsReadHost,
	now: Date,
): Promise<ThermalLearningSignal> {
	const timezone = intentAdminConfigFromAdapter(host.config).timezone || "Europe/Berlin";
	const [
		rawStatus,
		rawHealth,
		samples,
		coolingRateCPerHAvg,
		coolingConstantPerH,
		coolingAsymptoteC,
		estimatedRemainingHours,
		estimatedEmptyAtRaw,
		byDayTypeJsonRaw,
	] = await Promise.all([
		readStr(host, "learning.thermal_runtime.status"),
		readStr(host, "learning.thermal_runtime.health"),
		readNum(host, "learning.thermal_runtime.samples"),
		readNum(host, "learning.thermal_runtime.cooling_rate_c_per_h_avg"),
		readNum(host, "learning.thermal_runtime.cooling_k_per_h"),
		readNum(host, "learning.thermal_runtime.cooling_asymptote_c"),
		readNum(host, "learning.thermal_runtime.estimated_remaining_hours"),
		readStr(host, "learning.thermal_runtime.estimated_empty_at"),
		readStr(host, "learning.thermal_runtime.by_day_type_json"),
	]);

	return buildThermalLearningSignal({
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
	});
}

async function readBatteryLearningSignal(host: FlexibleContributionsReadHost): Promise<BatteryLearningSignal> {
	const [
		rawStatus,
		sampleDays,
		avgNightDischargeKwh,
		avgChargePowerW,
		maxChargePowerW,
		topoffDueRaw,
		topoffDaysRemaining,
		estimatedRuntimeDays,
	] = await Promise.all([
		readStr(host, "learning.battery_runtime.status"),
		readNum(host, "learning.battery_runtime.sample_days"),
		readNum(host, "learning.battery_runtime.avg_night_discharge_kwh"),
		readNum(host, "learning.battery_runtime.avg_charge_power_w"),
		readNum(host, "learning.battery_runtime.max_charge_power_w"),
		readNum(host, "learning.battery_runtime.topoff_due"),
		readNum(host, "learning.battery_runtime.topoff_days_remaining"),
		readNum(host, "learning.battery_runtime.estimated_runtime_days"),
	]);

	return buildBatteryLearningSignal({
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
async function readBatteryChargeLogicDecision(
	host: FlexibleContributionsReadHost,
	now: Date,
	socPct: number | null,
	governanceEnabled: boolean,
	modePolicy: PlannerModePolicy,
): Promise<BatteryChargeLogicDecision> {
	const timezone = intentAdminConfigFromAdapter(host.config).timezone;
	const [
		correctedTodayKwh,
		correctedTomorrowKwh,
		pvConfidence,
		forecastTodayRaw,
		forecastTomorrowRaw,
		forecastHorizonRaw,
		snowCoverSuspected,
	] = await Promise.all([
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readNum(host, "learning.pv_bias.confidence_pct"),
		readStr(host, "learning.house_load.forecast_today_json"),
		readStr(host, "learning.house_load.forecast_tomorrow_json"),
		readStr(host, "learning.house_load.forecast_horizon_json"),
		readBool(host, "ems_mirror.snow_cover_suspected"),
	]);

	const [pvHorizonValues, pvHorizonConfidence] = await Promise.all([
		Promise.all(
			Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
				readNum(host, `learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`),
			),
		),
		Promise.all(
			Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
				readNum(host, `learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`),
			),
		),
	]);

	const houseHorizon = parseHouseLoadForecastHorizonJson(forecastHorizonRaw);
	const todayKey = localDateKeyInTimezone(now, timezone);

	const days: BatteryChargeLogicDayInput[] = [
		{
			dayIndex: 0,
			dateKey: todayKey,
			pvKwh: correctedTodayKwh,
			loadKwh: dailyKwhFromHouseLoadDayForecast(parseHouseLoadForecastJson(forecastTodayRaw)),
			pvConfidencePct: pvConfidence,
		},
		{
			dayIndex: 1,
			dateKey: addDaysToDateKey(todayKey, 1),
			pvKwh: correctedTomorrowKwh,
			loadKwh: dailyKwhFromHouseLoadDayForecast(parseHouseLoadForecastJson(forecastTomorrowRaw)),
			pvConfidencePct: pvConfidence,
		},
	];
	for (let d = PV_HORIZON_EXTENDED_FIRST_DAY; d <= PV_HORIZON_DAY_COUNT; d++) {
		const idx = d - PV_HORIZON_EXTENDED_FIRST_DAY;
		days.push({
			dayIndex: d - 1,
			dateKey: addDaysToDateKey(todayKey, d - 1),
			pvKwh: pvHorizonValues[idx] ?? null,
			loadKwh: dailyKwhFromHouseLoadDayForecast(houseHorizon?.[idx] ?? null),
			pvConfidencePct: pvHorizonConfidence[idx] ?? null,
		});
	}

	return planBatteryChargeLogic({
		now,
		socPct,
		snowCoverSuspected: snowCoverSuspected === true,
		config: batteryChargeLogicConfigFromAdapter(host.config),
		modePolicy,
		governanceEnabled,
		days,
	});
}

export interface CollectedFlexibleContributions {
	contributions: PlanContribution[];
}

export async function collectFlexibleContributions(
	host: FlexibleContributionsReadHost,
	now: Date,
	gridForecast: GridSupplyForecast | null,
): Promise<CollectedFlexibleContributions> {
	const config = host.config;
	const globalModeRaw = await readStr(host, "global_modes.active");
	const modePolicy = plannerModePolicyFromGlobalMode(globalModeRaw);
	const globalModeOff = modePolicy.mode === "off";
	const batteryCfg = batteryConfigFromAdapter(config);

	const [
		batteryEnabled,
		batteryGov,
		wallboxEnabled,
		wallboxGov,
		immersionEnabled,
		immersionGov,
		climateEnabled,
		climateGov,
		socPct,
		capacityEffective,
		capacityNet,
		capacitySource,
		minSoc,
		maxSoc,
		chargeCapable,
		dischargeCapable,
		batteryFault,
		batteryLockout,
		telemetryValid,
		telemetryStale,
		telemetryReady,
		ownershipActive,
		batteryIntentRaw,
		connected,
		charging,
		vehicleSoc,
		planSoc,
		planActive,
		sessionKwh,
		chargeRemainingKwh,
		effectiveLimitSoc,
		deadlineRaw,
		activePhases,
		maxCurrentA,
		evccVehicleName,
		evccVehicleTitle,
		activeVehicleRequiredKwh,
		activeVehicleSocEnergyReady,
		bufferTemp,
		immersionFault,
		immersionState,
		autoTargetReached,
		thermalRaw,
		pvToday,
		pvTomorrow,
		pvBiasStatus,
		aiThermal,
		outdoorTemp,
		outdoorForecastMaxC,
		houseLoadTodayRaw,
	] = await Promise.all([
		readBool(host, addonEnabled("battery")),
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "battery"),
		readBool(host, addonEnabled("wallbox")),
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "wallbox"),
		readBool(host, addonEnabled("immersion_heater")),
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "immersion_heater"),
		readBool(host, addonEnabled("air_conditioning")),
		isAddonGovernanceEnabledFromState((id) => host.getStateAsync(id), "climate"),
		readNum(host, BAT.telemetry.socPct),
		readNum(host, BAT.telemetry.capacityEffectiveKwh),
		readNum(host, BAT.identity.capacityNetKwh),
		readStr(host, BAT.identity.capacitySource),
		readNum(host, BAT.limits.hardwareMinSocPct),
		readNum(host, BAT.limits.hardwareMaxSocPct),
		readBool(host, BAT.capabilities.setChargePower),
		readBool(host, BAT.capabilities.setDischargePower),
		readBool(host, BAT.status.fault),
		readBool(host, BAT.status.lockout),
		readBool(host, BAT.telemetry.valid),
		readBool(host, BAT.telemetry.stale),
		readBool(host, BAT.status.telemetryReady),
		readBool(host, BAT.runtime.ownershipActive),
		host.getStateAsync("user_intent.battery.resolved_json"),
		readBool(host, WALLBOX_EVCC_STATES.connected),
		readBool(host, WALLBOX_EVCC_STATES.charging),
		readNum(host, WALLBOX_EVCC_STATES.vehicleSocPct),
		readNum(host, WALLBOX_EVCC_STATES.planSocPct),
		readBool(host, WALLBOX_EVCC_STATES.planActive),
		readNum(host, WALLBOX_EVCC_STATES.sessionEnergyKwh),
		readNum(host, WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh),
		readNum(host, WALLBOX_EVCC_STATES.effectiveLimitSocPct),
		readStr(host, WALLBOX_EVCC_STATES.effectivePlanTime),
		readNum(host, WALLBOX_EVCC_STATES.activePhases),
		readNum(host, WALLBOX_EVCC_STATES.maxCurrentA),
		readStr(host, WALLBOX_EVCC_STATES.vehicleName),
		readStr(host, WALLBOX_EVCC_STATES.vehicleTitle),
		readNum(host, WALLBOX_RUNTIME_STATES.activeVehicleRequiredBatteryEnergyKwh),
		readBool(host, WALLBOX_RUNTIME_STATES.activeVehicleSocEnergyReady),
		readNum(host, IMMERSION_RUNTIME_STATES.bufferTemperatureC),
		readBool(host, IMMERSION_RUNTIME_STATES.faultActive),
		readStr(host, IMMERSION_RUNTIME_STATES.state),
		readBool(host, IMMERSION_RUNTIME_STATES.autoTargetReached),
		host.getStateAsync("user_intent.thermal.resolved_json"),
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readStr(host, "learning.pv_bias.status"),
		readBool(host, addonGovernanceAiAllowedState("immersion_heater")),
		readOutdoorTempC(host),
		readNum(host, "learning.weather.horizon.day1.max_temp_c"),
		readStr(host, "learning.house_load.forecast_today_json"),
	]);

	const batteryIntent = parseResolvedBatteryIntentJson(batteryIntentRaw?.val);
	const topOff =
		batteryIntent?.top_off_requested?.status === "valid" && batteryIntent.top_off_requested.value === true;

	const thermalIntent = parseResolvedIntentJson(thermalRaw?.val);
	const thermalMode = resolvedModeFromIntent(thermalIntent);
	const immersionConfig = immersionDeviceConfigFromAdapter(config);
	const relayMapped = immersionConfig.stages.some((s) => s.enabled && s.setStateId.trim() !== "");

	const evccCfg = wallboxEvccTelemetryConfigFromAdapter(config);
	const evccConfigured = evccCfg.enabledStateId.trim().length > 0;

	let remainingEnergyKwh: number | null =
		chargeRemainingKwh !== null && Number.isFinite(chargeRemainingKwh)
			? Math.max(0, chargeRemainingKwh)
			: null;
	if (
		remainingEnergyKwh === null &&
		activeVehicleSocEnergyReady === true &&
		activeVehicleRequiredKwh !== null &&
		Number.isFinite(activeVehicleRequiredKwh)
	) {
		remainingEnergyKwh = Math.max(0, activeVehicleRequiredKwh);
	}

	const mapEntry = lookupVehicleMapEntry(
		wallboxVehicleMapFromAdapter(config).entries,
		evccVehicleName,
		evccVehicleTitle,
	);
	const vehicleCapacityKwh =
		mapEntry?.batteryCapacityNetKwh !== null &&
		mapEntry?.batteryCapacityNetKwh !== undefined &&
		mapEntry.batteryCapacityNetKwh > 0
			? mapEntry.batteryCapacityNetKwh
			: null;
	const vehicleMaxAcChargePowerW =
		mapEntry?.maxAcChargePowerW !== null &&
		mapEntry?.maxAcChargePowerW !== undefined &&
		mapEntry.maxAcChargePowerW > 0
			? mapEntry.maxAcChargePowerW
			: null;

	let fallbackTargetSocPct: number | null = null;
	const intentEvcc = intentEvccConfigFromAdapter(config);
	if (intentEvcc.targetSocStateId) {
		fallbackTargetSocPct = await readForeignNum(host, intentEvcc.targetSocStateId);
		if (fallbackTargetSocPct !== null && !(fallbackTargetSocPct > 0 && fallbackTargetSocPct <= 100)) {
			fallbackTargetSocPct = null;
		}
	}

	const acConfig = acGlobalConfigFromAdapter(config);
	const stats = await readConsumerStats(host);

	const thermalLearning = await readThermalLearningSignal(host, now);
	const batteryLearning = await readBatteryLearningSignal(host);
	const chargeLogic = await readBatteryChargeLogicDecision(host, now, socPct, batteryGov, modePolicy);

	const houseLoadTodayKwh = dailyKwhFromHouseLoadDayForecast(parseHouseLoadForecastJson(houseLoadTodayRaw));
	const batteryTodayPvSurplusKwh = todayPvSurplusKwh(pvToday, houseLoadTodayKwh);

	// Technische Hardwaregrenze aus Admin-Config (`bat_hw_max_charge_w`) — nie Runtime-Befehl
	// und nie Netz-/Hausanschluss-Grenze als Planungs-Cap.
	const hwMaxChargeW =
		batteryCfg.limits.maxChargeW !== null && batteryCfg.limits.maxChargeW > 0
			? batteryCfg.limits.maxChargeW
			: null;

	const acUnits = await Promise.all(
		Array.from({ length: AC_UNIT_COUNT }, async (_, i) => {
			const index = i + 1;
			const unit = acConfig.units.find((u) => u.index === index)!;
			const ids = acUnitRuntimeStates(index);
			const [roomTempC, roomHumidityPct, faultState, cleaningActive] = await Promise.all([
				readNum(host, ids.roomTempC),
				readNum(host, ids.roomHumidityPct),
				readStr(host, ids.state),
				readBool(host, ids.cleaningActive),
			]);
			const consumerKey = acUnitConsumerKey(index);
			return {
				unit,
				roomTempC,
				roomHumidityPct,
				consumerStats: stats?.consumers?.[consumerKey],
				mappingsReady: unit.enabled,
				fault: faultState === "fault",
				lockout: faultState === "blocked" || faultState === "rate_limited",
				cleaningBlocked: cleaningActive === true,
			};
		}),
	);

	const contributions = buildFlexibleContributions({
		battery: {
			now,
			addonEnabled: batteryEnabled !== false,
			governanceEnabled: batteryGov,
			globalModeOff,
			modePolicy,
			gridForecast,
			profileId: batteryProfileIdFromConfig(config),
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
			deadlineIso: validIsoDeadline(deadlineRaw),
			activePhases,
			maxCurrentA,
			evccConfigured,
		},
		immersion: {
			now,
			addonEnabled: immersionEnabled !== false,
			governanceEnabled: immersionGov,
			globalModeOff,
			modePolicy,
			config: immersionConfig,
			bufferTempC: bufferTemp,
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
			autoTargetReached: autoTargetReached === true,
		},
		airConditioning: {
			now,
			addonEnabled: climateEnabled !== false,
			governanceEnabled: climateGov,
			globalModeOff,
			modePolicy,
			acConfig,
			outdoorTempC: outdoorTemp,
			outdoorForecastMaxC,
			units: acUnits,
		},
	});

	return { contributions };
}

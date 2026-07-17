import type { DayForecastJson } from "../learning/house_load/types";
import { SEGMENTS, type HouseLoadSegment } from "../learning/house_load/constants";
import { immersionDeviceConfigFromAdapter } from "../addons/immersion_heater/device_config";
import { acGlobalConfigFromAdapter } from "../addons/air_conditioning/config";
import { AC_UNIT_COUNT } from "../addons/air_conditioning/constants";
import { buildPvContribution } from "../operator/contributions/pv";
import { buildHouseLoadContribution } from "../operator/contributions/house_load";
import { buildWeatherContribution } from "../operator/contributions/weather";
import {
	buildGlobalConstraintsContribution,
	buildGridSupplyContribution,
	buildHouseMainFuseConstraintContribution,
} from "../operator/contributions/constraints";
import { buildFlexibleContributions } from "../operator/contributions/flexible/build";
import { plannerModePolicyFromGlobalMode } from "../planner/mode_policy";
import { buildGridSupplyForecast } from "../grid_supply/forecast";
import { gridSupplyBuildInputFromSnapshot } from "../planner_preparation/prepare";
import type { PlannerInputSnapshot, SnapshotHouseLoadDayForecast } from "../planner_snapshot/types";
import type { GridSupplyForecast, PlanContribution } from "../operator/types";
import { addDaysToDateKey, localDateKeyInTimezone } from "../operator/time";

function houseLoadDayFromSnapshot(f: SnapshotHouseLoadDayForecast | null): DayForecastJson | null {
	if (!f) return null;
	const segments: DayForecastJson["segments"] = {};
	for (const seg of SEGMENTS) {
		const found = f.segments.find((s) => s.segmentId === seg);
		if (found && found.avgW !== null) {
			segments[seg as HouseLoadSegment] = {
				avg_w: found.avgW,
				source: "snapshot",
				fallback_level: "none",
				confidence: 50,
			};
		}
	}
	return {
		date: f.dateKey,
		season: "spring",
		weekday: "monday",
		day_type: "weekday",
		segments,
	};
}

function governanceEnabled(snapshot: PlannerInputSnapshot, addonId: string): boolean {
	const entry = snapshot.governance.addons.find((a) => a.addonId === addonId);
	return entry?.enabled !== false;
}

function addonEnabledFromGov(snapshot: PlannerInputSnapshot, addonId: string): boolean {
	const entry = snapshot.governance.addons.find((a) => a.addonId === addonId);
	if (entry) return entry.enabled === true;
	return false;
}

/**
 * Pure contribution collection from PlannerInputSnapshot — no adapter I/O.
 * Shared by in-process reference path and worker candidate pipeline.
 */
export function collectContributionsFromSnapshot(snapshot: PlannerInputSnapshot): {
	now: Date;
	timezone: string;
	gridForecast: GridSupplyForecast;
	contributions: PlanContribution[];
} {
	const now = new Date(snapshot.capturedAt);
	const timezone = snapshot.timezone || "Europe/Berlin";
	const gridForecast = buildGridSupplyForecast(gridSupplyBuildInputFromSnapshot(snapshot));
	const modePolicy = plannerModePolicyFromGlobalMode(snapshot.general.globalMode);
	const globalModeOff = modePolicy.mode === "off";
	const todayKey = localDateKeyInTimezone(now, timezone);

	const pvHorizon = snapshot.learning.pvHorizon.map((d) => ({
		dayIndex: d.dayIndex,
		dateKey: d.dateKey || addDaysToDateKey(todayKey, Math.max(0, d.dayIndex)),
		correctedKwh: d.correctedKwh,
		confidencePct: d.confidencePct,
	}));
	if (pvHorizon.length === 0) {
		pvHorizon.push(
			{
				dayIndex: 0,
				dateKey: todayKey,
				correctedKwh: snapshot.learning.pvBias.correctedTodayKwh,
				confidencePct: snapshot.learning.pvBias.confidencePct,
			},
			{
				dayIndex: 1,
				dateKey: addDaysToDateKey(todayKey, 1),
				correctedKwh: snapshot.learning.pvBias.correctedTomorrowKwh,
				confidencePct: snapshot.learning.pvBias.confidencePct,
			},
		);
	}

	const constraintInput = {
		now,
		globalMode: snapshot.general.globalMode,
		configuredHouseFuseLimitW: snapshot.policy.houseFuseLimitW,
		configuredMaxGridImportW: snapshot.policy.maxGridImportW,
		effectiveMaxGridImportW: gridForecast.effectiveMaxGridImportW,
		gridImportAllowed: snapshot.policy.gridImportAllowed !== false,
		gridSupplyQuality: gridForecast.quality,
	};

	const fixed: PlanContribution[] = [
		buildPvContribution({
			now,
			correctedTodayKwh: snapshot.learning.pvBias.correctedTodayKwh,
			correctedTomorrowKwh: snapshot.learning.pvBias.correctedTomorrowKwh,
			rawTodayKwh: snapshot.learning.pvBias.rawTodayKwh,
			rawTomorrowKwh: snapshot.learning.pvBias.rawTomorrowKwh,
			confidencePct: snapshot.learning.pvBias.confidencePct,
			status: snapshot.learning.pvBias.status,
			lastUpdateTs: snapshot.learning.pvBias.lastUpdateTs,
			source: "snapshot",
			horizonDays: pvHorizon,
		}),
		buildHouseLoadContribution({
			now,
			timezone,
			status: snapshot.learning.houseLoad.status,
			confidence: snapshot.learning.houseLoad.confidence,
			forecastToday: houseLoadDayFromSnapshot(snapshot.learning.houseLoad.forecastToday),
			forecastTomorrow: houseLoadDayFromSnapshot(snapshot.learning.houseLoad.forecastTomorrow),
			lastUpdate: snapshot.learning.houseLoad.lastUpdate,
		}),
		buildWeatherContribution({
			now,
			learningStatus: snapshot.learning.weather.status,
			learningHealth: snapshot.learning.weather.health,
			confidencePct: snapshot.learning.weather.confidencePct,
			lastUpdate: snapshot.learning.weather.lastUpdate,
			forecastSource: snapshot.learning.weather.forecastSource,
			actualSource: snapshot.learning.weather.actualSource,
			outdoorTempC: snapshot.live.outdoorTempC,
			cloudPct: snapshot.live.cloudPct,
			hourlyPoints: [],
			todayMinTempC: null,
			todayMaxTempC: null,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: null,
			forecastHorizonEnd: null,
		}),
		buildGridSupplyContribution(gridForecast),
		buildHouseMainFuseConstraintContribution(constraintInput),
		buildGlobalConstraintsContribution(constraintInput),
	];

	const immersionBase = immersionDeviceConfigFromAdapter({});
	const immersionConfig = {
		...immersionBase,
		forecastModeEnabled: snapshot.thermal.config.forecastModeEnabled,
		planningMaxTempC: snapshot.thermal.config.planningMaxTempC ?? immersionBase.planningMaxTempC,
		minimumRuntimeSec:
			snapshot.thermal.config.minRuntimeMin != null
				? snapshot.thermal.config.minRuntimeMin * 60
				: immersionBase.minimumRuntimeSec,
		minimumPauseSec:
			snapshot.thermal.config.minPauseMin != null
				? snapshot.thermal.config.minPauseMin * 60
				: immersionBase.minimumPauseSec,
		stages: snapshot.thermal.config.stages.length
			? snapshot.thermal.config.stages.map((s) => ({
					index: s.index,
					enabled: s.enabled,
					name: s.label ?? `Stufe ${s.index}`,
					nominalPowerW: s.nominalPowerW,
					setStateId: s.enabled ? "mapped" : "",
					feedbackStateId: "",
				}))
			: immersionBase.stages.map((s) => ({
					...s,
					setStateId: s.enabled ? s.setStateId || "mapped" : "",
				})),
	};

	const acBase = acGlobalConfigFromAdapter({});
	const acUnits = acBase.units.map((unit) => {
		const snap = snapshot.airConditioning.units.find((u) => u.index === unit.index);
		return {
			...unit,
			enabled: snap?.enabled === true,
			coolingSetpointC: snap?.targetTempC ?? unit.coolingSetpointC,
			estimatedPowerW: snap?.learnedPowerW && snap.learnedPowerW > 0 ? snap.learnedPowerW : unit.estimatedPowerW,
		};
	});
	const acConfig = { ...acBase, units: acUnits };

	const thermalModeRaw = String(snapshot.intents.thermal.mode ?? "auto").toLowerCase();
	const thermalMode = thermalModeRaw === "off" || thermalModeRaw === "force" ? thermalModeRaw : "auto";

	const flexible = buildFlexibleContributions({
		battery: {
			now,
			addonEnabled: addonEnabledFromGov(snapshot, "battery"),
			governanceEnabled: governanceEnabled(snapshot, "battery"),
			globalModeOff,
			modePolicy,
			gridForecast,
			profileId: "generic_readonly",
			socPct: snapshot.battery.socPct,
			capacityManualKwh: snapshot.battery.capacityEffectiveKwh,
			capacityMappedKwh: snapshot.battery.capacityNetKwh,
			capacitySource: snapshot.battery.capacitySource,
			minSocPct: snapshot.battery.minSocPct,
			maxSocPct: snapshot.battery.maxSocPct,
			maxChargeW: snapshot.battery.maxChargeW,
			chargeCapable: snapshot.battery.chargeCapable === true,
			dischargeCapable: snapshot.battery.dischargeCapable === true,
			fault: snapshot.battery.fault === true,
			lockout: snapshot.battery.lockout === true,
			telemetryValid: snapshot.battery.telemetryValid === true,
			telemetryStale: snapshot.battery.telemetryStale === true,
			mappingsReady: snapshot.battery.telemetryReady === true,
			topOffRequested: snapshot.intents.battery.topOffRequested === true,
			ownershipActive: snapshot.battery.ownershipActive === true,
			winterGridActive: snapshot.battery.winterGridActive === true,
		},
		wallbox: {
			now,
			addonEnabled: addonEnabledFromGov(snapshot, "wallbox"),
			governanceEnabled: governanceEnabled(snapshot, "wallbox"),
			globalModeOff,
			modePolicy,
			gridForecast,
			connected: snapshot.wallbox.connected === true,
			charging: snapshot.wallbox.charging === true,
			vehicleSocPct: snapshot.wallbox.vehicleSocPct,
			planSocPct: snapshot.wallbox.planSocPct,
			planActive: snapshot.wallbox.planActive === true,
			sessionEnergyKwh: snapshot.wallbox.sessionEnergyKwh,
			remainingEnergyKwh: null,
			vehicleCapacityKwh: null,
			deadlineIso: snapshot.wallbox.deadlineIso,
			activePhases: snapshot.wallbox.activePhases,
			maxCurrentA: snapshot.wallbox.maxCurrentA,
			evccConfigured: snapshot.wallbox.evccConfigured === true,
		},
		immersion: {
			now,
			addonEnabled: addonEnabledFromGov(snapshot, "immersion_heater"),
			governanceEnabled: governanceEnabled(snapshot, "immersion_heater"),
			globalModeOff,
			modePolicy,
			config: immersionConfig,
			bufferTempC: snapshot.thermal.bufferTempC,
			thermalMode,
			fault: snapshot.thermal.faultActive === true,
			lockout: false,
			relayMapped: immersionConfig.stages.some((s) => s.enabled && s.setStateId),
			pvTodayKwh: snapshot.learning.pvBias.correctedTodayKwh,
			pvTomorrowKwh: snapshot.learning.pvBias.correctedTomorrowKwh,
			pvBiasStatus: snapshot.learning.pvBias.status,
			forecastModeEnabled: immersionConfig.forecastModeEnabled,
			aiOptimizationAllowed: false,
		},
		airConditioning: {
			now,
			addonEnabled: addonEnabledFromGov(snapshot, "air_conditioning"),
			governanceEnabled: governanceEnabled(snapshot, "air_conditioning"),
			globalModeOff,
			modePolicy,
			acConfig,
			outdoorTempC: snapshot.live.outdoorTempC,
			units: Array.from({ length: AC_UNIT_COUNT }, (_, i) => {
				const index = i + 1;
				const unit = acUnits.find((u) => u.index === index)!;
				const snap = snapshot.airConditioning.units.find((u) => u.index === index);
				return {
					unit,
					roomTempC: snap?.roomTempC ?? null,
					consumerStats: undefined,
					mappingsReady: unit.enabled,
					fault: false,
					lockout: false,
					cleaningBlocked: snap?.cleaningActive === true,
				};
			}),
		},
	});

	return {
		now,
		timezone,
		gridForecast,
		contributions: [...fixed, ...flexible],
	};
}

import { asNum } from "../../ems_light/state_util";
import type { StateHost } from "../../ems_light/state_util";
import { intentAdminConfigFromAdapter } from "../../intent/config";
import { weatherConfigFromAdapter } from "../../learning/weather/config";
import { PV_HORIZON_EXTENDED_FIRST_DAY, PV_HORIZON_DAY_COUNT } from "../../learning/pv_horizon/constants";
import type { DayForecastJson } from "../../learning/house_load/types";
import type { GridSupplyForecast } from "../types";
import { addDaysToDateKey, localDateKeyInTimezone } from "../time";
import { buildPvContribution, type PvContributionBuildInput, type PvHorizonDayInput, type PvShapeInput } from "./pv";
import type { PvShapeHourPoint } from "./pv_shape";
import { pvShapeConfigFromAdapter, pvShapeConfigReady } from "./pv_shape_config";
import { buildHouseLoadContribution } from "./house_load";
import { buildWeatherContribution, type WeatherHourlyPoint } from "./weather";
import {
	buildGlobalConstraintsContribution,
	buildGridSupplyContribution,
	buildHouseMainFuseConstraintContribution,
	type ConstraintContributionBuildInput,
} from "./constraints";
import type { PlanContribution } from "../types";
import { collectGridSupplyBuildInput, type GridSupplyReadHost } from "../supply/grid_read";
import { buildGridSupplyForecast } from "../supply/grid";

export type ContributionsReadHost = GridSupplyReadHost &
	StateHost & {
		getForeignObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	};

async function readNum(host: ContributionsReadHost, relId: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(relId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readStr(host: ContributionsReadHost, relId: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(relId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

async function readForeignNum(host: ContributionsReadHost, stateId: string): Promise<number | null> {
	if (!stateId.trim()) return null;
	try {
		const st = await host.getForeignStateAsync?.(stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readForeignStr(host: ContributionsReadHost, stateId: string): Promise<string | null> {
	if (!stateId.trim()) return null;
	try {
		const st = await host.getForeignStateAsync?.(stateId);
		if (st?.val == null || st.val === "") return null;
		return String(st.val);
	} catch {
		return null;
	}
}

/**
 * `system.config.common.latitude/longitude` — kein erfundener Standort ohne diesen Eintrag.
 * Toleranter Zahlen-Parse (wie `asNum`): manche Systemeinstellungen speichern den Wert je nach
 * Float-Teilerzeichen als String mit Komma statt Punkt — ein reiner `typeof === "number"`-Check
 * würde diesen sonst gültigen Standort fälschlich verwerfen.
 */
async function readSystemLocation(
	host: ContributionsReadHost,
): Promise<{ lat: number | null; lon: number | null }> {
	try {
		const obj = await host.getForeignObjectAsync?.("system.config");
		const common = (obj as { common?: Record<string, unknown> } | null | undefined)?.common;
		const lat = asNum(common?.latitude);
		const lon = asNum(common?.longitude);
		return { lat, lon };
	} catch {
		return { lat: null, lon: null };
	}
}

const PV_SHAPE_HOURLY_PROBE_COUNT = 24;

/**
 * Liest ein BrightSky-artiges rollierendes Stunden-Array (`prefix.NN.timestamp/.cloud_cover/.solar_estimate`).
 * Andere Wetteradapter mit abweichender Struktur liefern hier einfach keine Treffer (fail-closed, kein Fallback).
 */
async function readPvShapeHourlyPoints(
	host: ContributionsReadHost,
	prefix: string,
): Promise<PvShapeHourPoint[]> {
	if (!prefix.trim()) return [];
	const indices = Array.from({ length: PV_SHAPE_HOURLY_PROBE_COUNT }, (_, i) => String(i).padStart(2, "0"));
	const rows = await Promise.all(
		indices.map(async (idx) => {
			const base = `${prefix}.${idx}`;
			const [timestampRaw, cloudPct, solarEstimateKwh] = await Promise.all([
				readForeignStr(host, `${base}.timestamp`),
				readForeignNum(host, `${base}.cloud_cover`),
				readForeignNum(host, `${base}.solar_estimate`),
			]);
			if (!timestampRaw) return null;
			const ms = Date.parse(timestampRaw);
			if (!Number.isFinite(ms)) return null;
			const point: PvShapeHourPoint = { hourStartIso: new Date(ms).toISOString(), cloudPct, solarEstimateKwh };
			return point;
		}),
	);
	return rows.filter((r): r is PvShapeHourPoint => r !== null);
}

async function readPvShapeInput(
	host: ContributionsReadHost,
	timezone: string,
): Promise<PvShapeInput | null> {
	const cfg = pvShapeConfigFromAdapter(host.config);
	if (!pvShapeConfigReady(cfg)) return null;

	const [location, hourlyPoints, kwp1, kwp2] = await Promise.all([
		readSystemLocation(host),
		readPvShapeHourlyPoints(host, cfg.brightskyHourlyPrefix),
		readForeignNum(host, cfg.kwpState1),
		readForeignNum(host, cfg.kwpState2),
	]);

	const capW = kwp1 !== null || kwp2 !== null ? Math.round(((kwp1 ?? 0) + (kwp2 ?? 0)) * 1000) : null;

	return {
		timezone,
		latDeg: location.lat,
		lonDeg: location.lon,
		hourlyPoints,
		capW,
	};
}

export function parseHouseLoadForecastJson(raw: string | null): DayForecastJson | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as DayForecastJson;
		if (!parsed || typeof parsed !== "object" || !parsed.segments) return null;
		return parsed;
	} catch {
		return null;
	}
}

function pvHorizonDays(
	now: Date,
	timezone: string,
	horizonValues: Array<number | null>,
	horizonConfidence: Array<number | null>,
): PvHorizonDayInput[] {
	const todayKey = localDateKeyInTimezone(now, timezone);
	const days: PvHorizonDayInput[] = [
		{ dayIndex: 0, dateKey: todayKey, correctedKwh: null, confidencePct: null },
		{ dayIndex: 1, dateKey: addDaysToDateKey(todayKey, 1), correctedKwh: null, confidencePct: null },
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

export interface CollectedContributions {
	now: Date;
	timezone: string;
	gridForecast: GridSupplyForecast;
	contributions: PlanContribution[];
	constraintInput: ConstraintContributionBuildInput;
}

export async function collectContributions(
	host: ContributionsReadHost,
	now: Date,
	gridForecast?: GridSupplyForecast,
): Promise<CollectedContributions> {
	const timezone = intentAdminConfigFromAdapter(host.config).timezone;
	const grid =
		gridForecast ?? buildGridSupplyForecast(await collectGridSupplyBuildInput(host, now));

	const [
		correctedTodayKwh,
		correctedTomorrowKwh,
		rawTodayKwh,
		rawTomorrowKwh,
		pvConfidence,
		pvStatus,
		pvLastUpdate,
		houseStatus,
		houseConfidence,
		forecastTodayRaw,
		forecastTomorrowRaw,
		houseLastUpdate,
		weatherStatus,
		weatherHealth,
		weatherConfidence,
		weatherLastUpdate,
		weatherForecastSource,
		weatherActualSource,
		globalMode,
	] = await Promise.all([
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readNum(host, "learning.pv_bias.raw_today_kwh"),
		readNum(host, "learning.pv_bias.raw_tomorrow_kwh"),
		readNum(host, "learning.pv_bias.confidence_pct"),
		readStr(host, "learning.pv_bias.status"),
		readStr(host, "learning.pv_bias.last_update_ts"),
		readStr(host, "learning.house_load.status"),
		readNum(host, "learning.house_load.confidence"),
		readStr(host, "learning.house_load.forecast_today_json"),
		readStr(host, "learning.house_load.forecast_tomorrow_json"),
		readStr(host, "learning.house_load.last_update"),
		readStr(host, "learning.weather.status"),
		readStr(host, "learning.weather.health"),
		readNum(host, "learning.weather.confidence_pct"),
		readStr(host, "learning.weather.last_update"),
		readStr(host, "learning.weather.forecast_source"),
		readStr(host, "learning.weather.actual_source"),
		readStr(host, "global_modes.active"),
	]);

	const horizonValues = await Promise.all(
		Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
			readNum(host, `learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.corrected_kwh`),
		),
	);
	const horizonConfidence = await Promise.all(
		Array.from({ length: PV_HORIZON_DAY_COUNT - PV_HORIZON_EXTENDED_FIRST_DAY + 1 }, (_, i) =>
			readNum(host, `learning.pv_horizon.day${PV_HORIZON_EXTENDED_FIRST_DAY + i}.confidence_pct`),
		),
	);

	const horizonDays = pvHorizonDays(now, timezone, horizonValues, horizonConfidence);
	horizonDays[0].correctedKwh = correctedTodayKwh;
	horizonDays[0].confidencePct = pvConfidence;
	horizonDays[1].correctedKwh = correctedTomorrowKwh;
	horizonDays[1].confidencePct = pvConfidence;

	const pvShape = await readPvShapeInput(host, timezone);

	const pvInput: PvContributionBuildInput = {
		now,
		correctedTodayKwh,
		correctedTomorrowKwh,
		rawTodayKwh,
		rawTomorrowKwh,
		confidencePct: pvConfidence,
		status: pvStatus,
		lastUpdateTs: pvLastUpdate,
		source: "learning.pv_bias",
		horizonDays,
		shape: pvShape,
	};

	const weatherCfg = weatherConfigFromAdapter(host.config);
	const tempMetric = weatherCfg.metrics.temp;
	const cloudMetric = weatherCfg.metrics.cloud;
	const [outdoorTempC, cloudPct] = await Promise.all([
		tempMetric
			? ((await readForeignNum(host, tempMetric.actualStateId)) ??
				(await readForeignNum(host, tempMetric.forecastStateId)))
			: null,
		cloudMetric
			? ((await readForeignNum(host, cloudMetric.actualStateId)) ??
				(await readForeignNum(host, cloudMetric.forecastStateId)))
			: null,
	]);

	const hourlyPoints: WeatherHourlyPoint[] = [];

	const constraintInput: ConstraintContributionBuildInput = {
		now,
		globalMode,
		configuredHouseFuseLimitW: grid.configuredHouseFuseLimitW,
		configuredMaxGridImportW: grid.configuredMaxGridImportW,
		effectiveMaxGridImportW: grid.effectiveMaxGridImportW,
		gridImportAllowed: grid.gridImportAllowed,
		gridSupplyQuality: grid.quality,
	};

	const contributions: PlanContribution[] = [
		buildPvContribution(pvInput),
		buildHouseLoadContribution({
			now,
			timezone,
			status: houseStatus,
			confidence: houseConfidence,
			forecastToday: parseHouseLoadForecastJson(forecastTodayRaw),
			forecastTomorrow: parseHouseLoadForecastJson(forecastTomorrowRaw),
			lastUpdate: houseLastUpdate,
		}),
		buildWeatherContribution({
			now,
			learningStatus: weatherStatus,
			learningHealth: weatherHealth,
			confidencePct: weatherConfidence,
			lastUpdate: weatherLastUpdate,
			forecastSource: weatherForecastSource,
			actualSource: weatherActualSource,
			outdoorTempC,
			cloudPct,
			hourlyPoints,
			todayMinTempC: null,
			todayMaxTempC: outdoorTempC,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: now.toISOString(),
			forecastHorizonEnd: addDaysToDateKey(localDateKeyInTimezone(now, timezone), 1) + "T23:59:59.999Z",
		}),
		buildGridSupplyContribution(grid),
		buildHouseMainFuseConstraintContribution(constraintInput),
		buildGlobalConstraintsContribution(constraintInput),
	];

	return { now, timezone, gridForecast: grid, contributions, constraintInput };
}

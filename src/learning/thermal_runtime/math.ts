import { seasonFromDate, dayTypeFromWeekday, weekdayFromDate } from "../house_load/time";
import {
	MAX_HISTORY_JSON_CYCLES,
	MIN_CYCLES_OK,
	MS_PER_HOUR,
	SEASONS,
	type ThermalDayType,
	type ThermalSeason,
} from "./constants";
import type {
	GroupSummary,
	RuntimeCycle,
	TempPoint,
	ThermalRuntimeComputeResult,
	ThermalRuntimeConfig,
	ThermalRuntimeHealth,
} from "./types";

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return round2((sorted[mid - 1] + sorted[mid]) / 2);
	}
	return round2(sorted[mid]);
}

/** Erkennt Kühlzyklen: Start >= full, Ende <= empty. Keine 0-Füllung bei Lücken. */
export function detectRuntimeCycles(
	points: TempPoint[],
	cfg: Pick<
		ThermalRuntimeConfig,
		"fullThresholdC" | "emptyThresholdC" | "minRuntimeHours" | "maxRuntimeHours"
	>,
): RuntimeCycle[] {
	const cycles: RuntimeCycle[] = [];
	let active: { startTs: number; startTempC: number } | null = null;

	for (const p of points) {
		if (!active) {
			if (p.tempC >= cfg.fullThresholdC) {
				active = { startTs: p.ts, startTempC: p.tempC };
			}
			continue;
		}

		if (p.tempC <= cfg.emptyThresholdC) {
			const runtimeHours = (p.ts - active.startTs) / MS_PER_HOUR;
			if (
				runtimeHours >= cfg.minRuntimeHours &&
				runtimeHours <= cfg.maxRuntimeHours &&
				active.startTempC > p.tempC
			) {
				const coolingRateCPerH = (active.startTempC - p.tempC) / runtimeHours;
				if (Number.isFinite(coolingRateCPerH) && coolingRateCPerH > 0) {
					const startDate = new Date(active.startTs);
					cycles.push({
						startTs: active.startTs,
						endTs: p.ts,
						startTempC: round2(active.startTempC),
						endTempC: round2(p.tempC),
						runtimeHours: round3(runtimeHours),
						coolingRateCPerH: round3(coolingRateCPerH),
						season: seasonFromDate(startDate) as ThermalSeason,
						dayType: dayTypeFromWeekday(weekdayFromDate(startDate)) as ThermalDayType,
					});
				}
			}
			active = null;
		}
	}

	return cycles;
}

function summarizeGroup(cycles: RuntimeCycle[]): GroupSummary {
	const runtimes = cycles.map((c) => c.runtimeHours);
	const rates = cycles.map((c) => c.coolingRateCPerH);
	return {
		samples: cycles.length,
		runtime_hours_avg: average(runtimes),
		runtime_hours_median: median(runtimes),
		cooling_rate_c_per_h_avg: average(rates),
	};
}

export function groupBySeason(
	cycles: RuntimeCycle[],
): Partial<Record<ThermalSeason, GroupSummary>> {
	const out: Partial<Record<ThermalSeason, GroupSummary>> = {};
	for (const season of SEASONS) {
		const group = cycles.filter((c) => c.season === season);
		if (group.length > 0) {
			out[season] = summarizeGroup(group);
		}
	}
	return out;
}

export function groupByDayType(
	cycles: RuntimeCycle[],
): Partial<Record<ThermalDayType, GroupSummary>> {
	const out: Partial<Record<ThermalDayType, GroupSummary>> = {};
	for (const dt of ["weekday", "weekend"] as ThermalDayType[]) {
		const group = cycles.filter((c) => c.dayType === dt);
		if (group.length > 0) {
			out[dt] = summarizeGroup(group);
		}
	}
	return out;
}

export function estimateRemainingHours(params: {
	currentTempC: number | null;
	fullThresholdC: number;
	emptyThresholdC: number;
	typicalRuntimeHours: number | null;
	coolingRateCPerHAvg: number | null;
}): number | null {
	const { currentTempC, fullThresholdC, emptyThresholdC, typicalRuntimeHours, coolingRateCPerHAvg } =
		params;

	if (currentTempC === null || !Number.isFinite(currentTempC)) {
		return null;
	}
	if (currentTempC <= emptyThresholdC) {
		return 0;
	}
	if (currentTempC >= fullThresholdC) {
		return typicalRuntimeHours !== null ? round3(typicalRuntimeHours) : null;
	}
	if (coolingRateCPerHAvg !== null && coolingRateCPerHAvg > 0) {
		return round3((currentTempC - emptyThresholdC) / coolingRateCPerHAvg);
	}
	return null;
}

export function estimatedEmptyAtIso(
	now: Date,
	remainingHours: number | null,
): string | null {
	if (remainingHours === null || !Number.isFinite(remainingHours)) {
		return null;
	}
	const ms = now.getTime() + remainingHours * MS_PER_HOUR;
	return new Date(ms).toISOString();
}

function deriveHealth(samples: number, hasSource: boolean, configValid: boolean): ThermalRuntimeHealth {
	if (!configValid) return "invalid_config";
	if (!hasSource) return "no_source";
	if (samples === 0) return "no_samples";
	if (samples < MIN_CYCLES_OK) return "degraded";
	return "ok";
}

export function computeThermalRuntimeLearning(params: {
	cycles: RuntimeCycle[];
	currentTempC: number | null;
	cfg: ThermalRuntimeConfig;
	sourceStateId: string;
	now: Date;
}): ThermalRuntimeComputeResult {
	const { cycles, currentTempC, cfg, sourceStateId, now } = params;
	const configValid = cfg.fullThresholdC > cfg.emptyThresholdC;

	if (!configValid) {
		return invalidConfigResult(sourceStateId);
	}

	const runtimes = cycles.map((c) => c.runtimeHours);
	const rates = cycles.map((c) => c.coolingRateCPerH);
	const runtimeHoursAvg = average(runtimes);
	const runtimeHoursMedian = median(runtimes);
	const coolingRateCPerHAvg = average(rates);

	const remaining = estimateRemainingHours({
		currentTempC,
		fullThresholdC: cfg.fullThresholdC,
		emptyThresholdC: cfg.emptyThresholdC,
		typicalRuntimeHours: runtimeHoursMedian ?? runtimeHoursAvg,
		coolingRateCPerHAvg,
	});

	const health = deriveHealth(cycles.length, Boolean(sourceStateId), configValid);
	let status: ThermalRuntimeComputeResult["status"] = "ready";
	if (cycles.length === 0) {
		status = "insufficient_data";
	} else if (cycles.length < MIN_CYCLES_OK) {
		status = "insufficient_data";
	}

	const historyJson = cycles.slice(-MAX_HISTORY_JSON_CYCLES).map((c) => ({
		...c,
		startTs: c.startTs,
		endTs: c.endTs,
	}));

	return {
		status,
		health,
		samples: cycles.length,
		runtimeHoursAvg,
		runtimeHoursMedian,
		coolingRateCPerHAvg,
		currentTemperatureC: currentTempC !== null ? round2(currentTempC) : null,
		estimatedRemainingHours: remaining,
		estimatedEmptyAt: estimatedEmptyAtIso(now, remaining),
		bySeasonJson: groupBySeason(cycles),
		byDayTypeJson: groupByDayType(cycles),
		historyJson,
		sourceStateId,
		lastError: "",
	};
}

export function noSourceResult(): ThermalRuntimeComputeResult {
	return {
		status: "no_source",
		health: "no_source",
		samples: 0,
		runtimeHoursAvg: null,
		runtimeHoursMedian: null,
		coolingRateCPerHAvg: null,
		currentTemperatureC: null,
		estimatedRemainingHours: null,
		estimatedEmptyAt: null,
		bySeasonJson: {},
		byDayTypeJson: {},
		historyJson: [],
		sourceStateId: "",
		lastError: "Keine Temperatur-Quelle — Admin-State oder addons.immersion_heater.mapping.buffer_temp_c konfigurieren.",
	};
}

export function disabledResult(): ThermalRuntimeComputeResult {
	return {
		...noSourceResult(),
		status: "disabled",
		lastError: "Thermal Runtime Learning in Admin deaktiviert.",
	};
}

export function invalidConfigResult(sourceStateId: string): ThermalRuntimeComputeResult {
	return {
		status: "invalid_config",
		health: "invalid_config",
		samples: 0,
		runtimeHoursAvg: null,
		runtimeHoursMedian: null,
		coolingRateCPerHAvg: null,
		currentTemperatureC: null,
		estimatedRemainingHours: null,
		estimatedEmptyAt: null,
		bySeasonJson: {},
		byDayTypeJson: {},
		historyJson: [],
		sourceStateId,
		lastError: "Ungültige Schwellwerte: full_threshold_c muss größer als empty_threshold_c sein.",
	};
}

export function errorResult(message: string, sourceStateId: string): ThermalRuntimeComputeResult {
	return {
		...noSourceResult(),
		status: "error",
		health: "error",
		sourceStateId,
		lastError: message,
	};
}

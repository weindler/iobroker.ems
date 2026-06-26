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

const MIN_COOLING_DROP_C = 1;
/** Mindest-Abkühlung eines echten Fall-Segments — schließt Plateaus/Nachheizen aus. */
const MIN_ACTIVE_SEGMENT_DROP_C = 2;
/** Rausch-Toleranz: kleiner Anstieg fragmentiert ein Fall-Segment nicht. */
const ACTIVE_NOISE_C = 0.3;
/** Temperatur steigt wieder über Peak → Überschuss-/Nachheizen, Segment abbrechen. */
const HEATING_RESUME_MARGIN_C = 0.5;

export type TempHistorySummary = {
	minC: number | null;
	maxC: number | null;
	pointsAboveFloor: number;
	pointsAtOrBelowFloor: number;
};

/** Kurzdiagnose für Logs — warum keine Zyklen erkannt wurden. */
export function summarizeTempHistory(
	points: TempPoint[],
	emptyThresholdC: number,
): TempHistorySummary {
	let minC: number | null = null;
	let maxC: number | null = null;
	let pointsAboveFloor = 0;
	let pointsAtOrBelowFloor = 0;
	for (const p of points) {
		if (minC === null || p.tempC < minC) minC = p.tempC;
		if (maxC === null || p.tempC > maxC) maxC = p.tempC;
		if (p.tempC > emptyThresholdC) pointsAboveFloor++;
		else pointsAtOrBelowFloor++;
	}
	return { minC, maxC, pointsAboveFloor, pointsAtOrBelowFloor };
}

/**
 * Erkennt Abkühl-Segmente: lokaler Peak (Überschuss-/Pufferstand) → Betriebs-Untergrenze.
 * Kein fester „Voll bei 60 °C“-Start — Start kann überall im Betriebsband liegen (z. B. 52–59 °C).
 */
export function detectRuntimeCycles(
	points: TempPoint[],
	cfg: Pick<
		ThermalRuntimeConfig,
		"fullThresholdC" | "emptyThresholdC" | "minRuntimeHours" | "maxRuntimeHours"
	>,
): RuntimeCycle[] {
	const cycles: RuntimeCycle[] = [];
	const floor = cfg.emptyThresholdC;
	if (points.length < 2) {
		return cycles;
	}

	let i = 0;
	while (i < points.length - 1) {
		while (i < points.length && points[i].tempC <= floor) {
			i++;
		}
		if (i >= points.length - 1) {
			break;
		}

		let peakIdx = i;
		let peakTemp = points[i].tempC;
		while (i + 1 < points.length && points[i + 1].tempC >= points[i].tempC - 0.05) {
			i++;
			if (points[i].tempC > peakTemp) {
				peakTemp = points[i].tempC;
				peakIdx = i;
			}
		}

		if (peakTemp <= floor + 0.1) {
			i++;
			continue;
		}

		let endIdx = -1;
		let resumeIdx = -1;
		for (let j = peakIdx + 1; j < points.length; j++) {
			const t = points[j].tempC;
			if (t <= floor) {
				endIdx = j;
				break;
			}
			if (t > peakTemp + HEATING_RESUME_MARGIN_C) {
				resumeIdx = j;
				break;
			}
		}

		if (endIdx > peakIdx) {
			const startP = points[peakIdx];
			const endP = points[endIdx];
			const runtimeHours = (endP.ts - startP.ts) / MS_PER_HOUR;
			const dropC = startP.tempC - endP.tempC;
			if (
				runtimeHours >= cfg.minRuntimeHours &&
				runtimeHours <= cfg.maxRuntimeHours &&
				dropC >= MIN_COOLING_DROP_C
			) {
				const coolingRateCPerH = dropC / runtimeHours;
				if (Number.isFinite(coolingRateCPerH) && coolingRateCPerH > 0) {
					const startDate = new Date(startP.ts);
					cycles.push({
						startTs: startP.ts,
						endTs: endP.ts,
						startTempC: round2(startP.tempC),
						endTempC: round2(endP.tempC),
						runtimeHours: round3(runtimeHours),
						coolingRateCPerH: round3(coolingRateCPerH),
						season: seasonFromDate(startDate) as ThermalSeason,
						dayType: dayTypeFromWeekday(weekdayFromDate(startDate)) as ThermalDayType,
					});
				}
			}
			i = endIdx + 1;
		} else if (resumeIdx >= 0) {
			i = resumeIdx;
		} else {
			i = peakIdx + 1;
		}
	}

	return cycles;
}

type CoolingSegment = { dropC: number; hours: number; rateCPerH: number };

/**
 * Sammelt echte Abkühl-Segmente (Peak → Tal) aus dem Verlauf.
 * Plateaus und Wiederaufheizen (Sonne/Überschuss) trennen Segmente und zählen NICHT
 * als Kühlung — so entsteht die natürliche No-Heat-Rate statt eines gemischten Trends.
 */
export function collectCoolingSegments(
	points: TempPoint[],
	minRuntimeHours: number,
): CoolingSegment[] {
	const segments: CoolingSegment[] = [];
	if (points.length < 2) {
		return segments;
	}

	let peakIdx = 0;
	let troughIdx = 0;

	const tryPush = (pIdx: number, tIdx: number): void => {
		if (tIdx <= pIdx) {
			return;
		}
		const dropC = points[pIdx].tempC - points[tIdx].tempC;
		const hours = (points[tIdx].ts - points[pIdx].ts) / MS_PER_HOUR;
		if (dropC < MIN_ACTIVE_SEGMENT_DROP_C || hours < minRuntimeHours) {
			return;
		}
		const rateCPerH = dropC / hours;
		if (Number.isFinite(rateCPerH) && rateCPerH > 0) {
			segments.push({ dropC: round2(dropC), hours: round3(hours), rateCPerH: round3(rateCPerH) });
		}
	};

	for (let i = 1; i < points.length; i++) {
		const t = points[i].tempC;
		if (troughIdx === peakIdx && t >= points[peakIdx].tempC) {
			// Noch am Aufheizen vor dem ersten Abfall → Peak nachziehen
			peakIdx = i;
			troughIdx = i;
			continue;
		}
		if (t <= points[troughIdx].tempC) {
			troughIdx = i;
			continue;
		}
		if (t > points[troughIdx].tempC + ACTIVE_NOISE_C) {
			// Wiederaufheizen → aktuelles Fall-Segment abschließen, neuer Peak
			tryPush(peakIdx, troughIdx);
			peakIdx = i;
			troughIdx = i;
		}
	}
	tryPush(peakIdx, troughIdx);

	return segments;
}

/**
 * Natürliche Kühlrate (°C/h) aus echten Fall-Segmenten — Median, robust gegen
 * Plateaus und einzelne Ausreißer. Untergrenze wird hier nicht gebraucht, da nur
 * die Steigung der Abkühlung zählt (nicht das absolute Niveau).
 */
export function estimateActiveCoolingRateCPerH(
	points: TempPoint[],
	cfg: Pick<ThermalRuntimeConfig, "emptyThresholdC" | "minRuntimeHours">,
): number | null {
	const segments = collectCoolingSegments(points, cfg.minRuntimeHours);
	if (segments.length === 0) {
		return null;
	}
	const sorted = segments.map((s) => s.rateCPerH).sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const rate =
		sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
	return rate > 0 ? round3(rate) : null;
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
	if (coolingRateCPerHAvg !== null && coolingRateCPerHAvg > 0) {
		return round3((currentTempC - emptyThresholdC) / coolingRateCPerHAvg);
	}
	// Fallback: lineare Skalierung im Betriebsband, wenn nur Median-Laufzeit bekannt
	if (
		typicalRuntimeHours !== null &&
		fullThresholdC > emptyThresholdC &&
		currentTempC > emptyThresholdC
	) {
		const frac = (currentTempC - emptyThresholdC) / (fullThresholdC - emptyThresholdC);
		return round3(typicalRuntimeHours * Math.min(1, Math.max(0, frac)));
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
	activeCoolingRateCPerH?: number | null;
}): ThermalRuntimeComputeResult {
	const { cycles, currentTempC, cfg, sourceStateId, now, activeCoolingRateCPerH = null } = params;
	const configValid = cfg.fullThresholdC > cfg.emptyThresholdC;

	if (!configValid) {
		return invalidConfigResult(sourceStateId);
	}

	const runtimes = cycles.map((c) => c.runtimeHours);
	const rates = cycles.map((c) => c.coolingRateCPerH);
	const runtimeHoursAvg = average(runtimes);
	const runtimeHoursMedian = median(runtimes);
	const coolingRateCPerHAvg = average(rates);
	const coolingRateForEstimate = coolingRateCPerHAvg ?? activeCoolingRateCPerH;

	const remaining = estimateRemainingHours({
		currentTempC,
		fullThresholdC: cfg.fullThresholdC,
		emptyThresholdC: cfg.emptyThresholdC,
		typicalRuntimeHours: runtimeHoursMedian ?? runtimeHoursAvg,
		coolingRateCPerHAvg: coolingRateForEstimate,
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

import {
	ACCURACY_ERROR_SCALE,
	MIN_MATCHED_HOURS_PER_DAY,
	MIN_SAMPLE_DAYS_READY,
} from "./constants";
import type {
	ForecastStability,
	MatchedHourPair,
	PriceForecastHealth,
	PriceForecastResult,
} from "./types";

export function meanOrNull(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number | null {
	if (values.length < 2) return null;
	const mean = meanOrNull(values);
	if (mean === null) return null;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/** Einfache transparente Accuracy: 100 − avgAbsErrorCt × 10 (geclippt 0–100). */
export function accuracyFromAvgErrorCt(avgErrorCt: number | null): number | null {
	if (avgErrorCt === null || !Number.isFinite(avgErrorCt)) return null;
	return Math.round(Math.max(0, Math.min(100, 100 - avgErrorCt * ACCURACY_ERROR_SCALE)));
}

export function stabilityFromDailyAccuracy(dailyAccuracies: number[]): ForecastStability {
	if (dailyAccuracies.length < 3) return "unknown";
	const sd = stdDev(dailyAccuracies);
	if (sd === null) return "unknown";
	if (sd <= 5) return "stable";
	if (sd <= 12) return "normal";
	return "volatile";
}

function pairsWithinDays(pairs: MatchedHourPair[], maxDayOffset: number, now: Date): MatchedHourPair[] {
	const cutoff = new Date(now);
	cutoff.setHours(0, 0, 0, 0);
	cutoff.setDate(cutoff.getDate() - maxDayOffset);
	const cutoffMs = cutoff.getTime();
	return pairs.filter((p) => p.hourStartMs >= cutoffMs);
}

function dailyGroups(pairs: MatchedHourPair[]): Map<string, MatchedHourPair[]> {
	const map = new Map<string, MatchedHourPair[]>();
	for (const p of pairs) {
		const list = map.get(p.targetDate) ?? [];
		list.push(p);
		map.set(p.targetDate, list);
	}
	return map;
}

function validSampleDays(groups: Map<string, MatchedHourPair[]>): string[] {
	return [...groups.entries()]
		.filter(([, list]) => list.length >= MIN_MATCHED_HOURS_PER_DAY)
		.map(([date]) => date);
}

export function computeForecastConfidence(params: {
	sampleDays: number;
	lookbackDays: number;
	coveragePct: number;
	avgAccuracy90d: number | null;
	stability: ForecastStability;
}): number {
	let score = 0;
	score += Math.min(40, (params.sampleDays / Math.max(1, params.lookbackDays)) * 40);
	score += (Math.min(100, params.coveragePct) / 100) * 30;
	if (params.avgAccuracy90d !== null) {
		score += (params.avgAccuracy90d / 100) * 20;
	}
	if (params.stability === "stable") score += 10;
	else if (params.stability === "normal") score += 6;
	else if (params.stability === "volatile") score += 2;
	return Math.round(Math.max(0, Math.min(100, score)));
}

export function healthFromMetrics(sampleDays: number, coveragePct: number): PriceForecastHealth {
	if (sampleDays >= 30 && coveragePct >= 80) return "ok";
	if (sampleDays >= 7 && coveragePct >= 50) return "warning";
	return "error";
}

export function computePriceForecastLearning(
	allPairs: MatchedHourPair[],
	lookbackDays: number,
	forecastSource: string,
	actualSource: string,
	now: Date,
): PriceForecastResult {
	const groups = dailyGroups(allPairs);
	const validDates = validSampleDays(groups);
	const expectedDays = lookbackDays;
	const missingDays = Math.max(0, expectedDays - validDates.length);
	const coveragePct =
		expectedDays > 0 ? Math.round((validDates.length / expectedDays) * 1000) / 10 : 0;

	const windowPairs = (maxOffset: number) => pairsWithinDays(allPairs, maxOffset, now);
	const errorsInWindow = (maxOffset: number) =>
		windowPairs(maxOffset).map((p) => p.absErrorCt);

	const avgErr7 = meanOrNull(errorsInWindow(6));
	const avgErr30 = meanOrNull(errorsInWindow(29));
	const avgErr90 = meanOrNull(errorsInWindow(lookbackDays - 1));

	const acc7 = accuracyFromAvgErrorCt(avgErr7);
	const acc30 = accuracyFromAvgErrorCt(avgErr30);
	const acc90 = accuracyFromAvgErrorCt(avgErr90);

	const dailyAccuracies: number[] = [];
	for (const date of validDates) {
		const dayPairs = groups.get(date) ?? [];
		const dayErr = meanOrNull(dayPairs.map((p) => p.absErrorCt));
		const dayAcc = accuracyFromAvgErrorCt(dayErr);
		if (dayAcc !== null) dailyAccuracies.push(dayAcc);
	}
	const stability = stabilityFromDailyAccuracy(dailyAccuracies);

	const forecastConfidence = computeForecastConfidence({
		sampleDays: validDates.length,
		lookbackDays,
		coveragePct,
		avgAccuracy90d: acc90,
		stability,
	});
	const health = healthFromMetrics(validDates.length, coveragePct);

	let status: PriceForecastResult["status"] = "ready";
	if (validDates.length === 0) {
		status = "insufficient_data";
	} else if (validDates.length < MIN_SAMPLE_DAYS_READY || forecastConfidence < 50) {
		status = "insufficient_data";
	}

	return {
		status,
		health,
		forecastConfidence,
		sampleDays: validDates.length,
		coveragePct,
		missingDays,
		forecastAccuracy7d: acc7,
		forecastAccuracy30d: acc30,
		forecastAccuracy90d: acc90,
		avgErrorCt7d: avgErr7 !== null ? Math.round(avgErr7 * 1000) / 1000 : null,
		avgErrorCt30d: avgErr30 !== null ? Math.round(avgErr30 * 1000) / 1000 : null,
		avgErrorCt90d: avgErr90 !== null ? Math.round(avgErr90 * 1000) / 1000 : null,
		stability,
		forecastSource,
		actualSource,
		error: "",
	};
}

export function disabledResult(): PriceForecastResult {
	return emptyResult("disabled", "", "", "Price Forecast Learning in Admin deaktiviert.");
}

export function missingForecastResult(): PriceForecastResult {
	return emptyResult(
		"missing_forecast",
		"",
		"",
		"Forecast- und Ist-State konfigurieren (PricesTomorrow.json + CurrentPrice.total).",
	);
}

export function errorResult(
	forecastSource: string,
	actualSource: string,
	message: string,
): PriceForecastResult {
	return emptyResult("error", forecastSource, actualSource, message);
}

function emptyResult(
	status: PriceForecastResult["status"],
	forecastSource: string,
	actualSource: string,
	error: string,
): PriceForecastResult {
	return {
		status,
		health: "error",
		forecastConfidence: 0,
		sampleDays: 0,
		coveragePct: 0,
		missingDays: 0,
		forecastAccuracy7d: null,
		forecastAccuracy30d: null,
		forecastAccuracy90d: null,
		avgErrorCt7d: null,
		avgErrorCt30d: null,
		avgErrorCt90d: null,
		stability: "unknown",
		forecastSource,
		actualSource,
		error,
	};
}

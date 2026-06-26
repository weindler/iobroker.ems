import {
	HOUR_PATTERN_TOP_N,
	MIN_SAMPLE_DAYS_READY,
	MIN_VALID_HOURS_PER_DAY,
} from "./constants";
import type { PriceDaySummary, PriceHealthLevel, PriceLearningResult } from "./types";
import type { PriceSample } from "./history";

export function meanOrNull(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number | null {
	if (values.length < 2) {
		return null;
	}
	const mean = meanOrNull(values);
	if (mean === null) {
		return null;
	}
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

export function volatilityCoefficient(values: number[]): number | null {
	const mean = meanOrNull(values);
	const sd = stdDev(values);
	if (mean === null || sd === null || mean <= 0) {
		return null;
	}
	return sd / mean;
}

function validDaySummaries(days: PriceDaySummary[]): PriceDaySummary[] {
	return days.filter((d) => d.validHours >= MIN_VALID_HOURS_PER_DAY && d.avgPriceEur !== null);
}

function avgForWindow(validDays: PriceDaySummary[], maxDayOffset: number): number | null {
	const prices = validDays
		.filter((d) => d.dayOffset <= maxDayOffset)
		.map((d) => d.avgPriceEur)
		.filter((v): v is number => v !== null);
	return meanOrNull(prices);
}

export function buildHourPatterns(
	samples: PriceSample[],
	topN = HOUR_PATTERN_TOP_N,
): { cheapHours: Record<string, number>; expensiveHours: Record<string, number> } {
	const byHour = new Map<number, number[]>();
	for (const s of samples) {
		const list = byHour.get(s.hourOfDay) ?? [];
		list.push(s.priceEur);
		byHour.set(s.hourOfDay, list);
	}

	const hourMeans: { hour: number; mean: number }[] = [];
	for (const [hour, prices] of byHour.entries()) {
		const mean = meanOrNull(prices);
		if (mean !== null) {
			hourMeans.push({ hour, mean });
		}
	}

	if (hourMeans.length < topN) {
		return { cheapHours: {}, expensiveHours: {} };
	}

	const means = hourMeans.map((h) => h.mean);
	const minMean = Math.min(...means);
	const maxMean = Math.max(...means);
	const span = maxMean - minMean;

	const cheapnessScore = (mean: number): number => {
		if (span <= 0) {
			return 0.5;
		}
		return round(1 - (mean - minMean) / span, 2);
	};

	const expensivenessScore = (mean: number): number => {
		if (span <= 0) {
			return 0.5;
		}
		return round((mean - minMean) / span, 2);
	};

	const sortedCheap = [...hourMeans].sort((a, b) => a.mean - b.mean).slice(0, topN);
	const sortedExpensive = [...hourMeans].sort((a, b) => b.mean - a.mean).slice(0, topN);

	const cheapHours: Record<string, number> = {};
	for (const h of sortedCheap) {
		cheapHours[String(h.hour)] = cheapnessScore(h.mean);
	}

	const expensiveHours: Record<string, number> = {};
	for (const h of sortedExpensive) {
		expensiveHours[String(h.hour)] = expensivenessScore(h.mean);
	}

	return { cheapHours, expensiveHours };
}

export function computeCoverage(validDays: PriceDaySummary[], lookbackDays: number): {
	coveragePct: number;
	missingDays: number;
} {
	const expected = lookbackDays;
	const covered = validDays.length;
	const missingDays = Math.max(0, expected - covered);
	const coveragePct = expected > 0 ? round((covered / expected) * 100, 1) : 0;
	return { coveragePct, missingDays };
}

export function healthFromMetrics(
	sampleDays: number,
	coveragePct: number,
): PriceHealthLevel {
	if (sampleDays >= 30 && coveragePct >= 80) {
		return "ok";
	}
	if (sampleDays >= 7 && coveragePct >= 50) {
		return "warning";
	}
	// Zu wenig/zu junge Historie ist kein Fehler — "error" bleibt echten Störungen
	// (keine Quelle, Exception, deaktiviert) vorbehalten.
	return "degraded";
}

export function computeConfidence(params: {
	sampleDays: number;
	lookbackDays: number;
	coveragePct: number;
	volatility30d: number | null;
}): number {
	let score = 0;

	const sampleRatio = Math.min(1, params.sampleDays / Math.max(1, params.lookbackDays));
	score += sampleRatio * 40;

	score += (Math.min(100, params.coveragePct) / 100) * 40;

	if (params.volatility30d !== null) {
		const volPenalty = Math.min(1, params.volatility30d / 0.5);
		score += (1 - volPenalty) * 20;
	} else {
		score += 5;
	}

	return Math.round(Math.min(100, Math.max(0, score)));
}

function round(n: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

export function computePriceLearning(
	samples: PriceSample[],
	daySummaries: PriceDaySummary[],
	lookbackDays: number,
	priceSource: string,
): PriceLearningResult {
	const validDays = validDaySummaries(daySummaries);
	const { coveragePct, missingDays } = computeCoverage(validDays, lookbackDays);

	const avgPrice7d = avgForWindow(validDays, 6);
	const avgPrice30d = avgForWindow(validDays, 29);
	const avgPrice90d = avgForWindow(validDays, lookbackDays - 1);

	const last30Daily = validDays
		.filter((d) => d.dayOffset <= 29)
		.map((d) => d.avgPriceEur)
		.filter((v): v is number => v !== null);
	const volatility30d = volatilityCoefficient(last30Daily);

	const { cheapHours, expensiveHours } = buildHourPatterns(samples);
	const confidence = computeConfidence({
		sampleDays: validDays.length,
		lookbackDays,
		coveragePct,
		volatility30d,
	});
	const health = healthFromMetrics(validDays.length, coveragePct);

	let status: PriceLearningResult["status"] = "ready";
	if (validDays.length === 0) {
		status = "insufficient_data";
	} else if (validDays.length < MIN_SAMPLE_DAYS_READY || confidence < 50) {
		status = "insufficient_data";
	}

	return {
		status,
		health,
		confidence,
		sampleDays: validDays.length,
		coveragePct,
		missingDays,
		avgPrice7d,
		avgPrice30d,
		avgPrice90d,
		volatility30d,
		cheapHours,
		expensiveHours,
		priceSource,
		error: "",
	};
}

export function errorResult(priceSource: string, message: string): PriceLearningResult {
	return {
		status: "error",
		health: "error",
		confidence: 0,
		sampleDays: 0,
		coveragePct: 0,
		missingDays: 0,
		avgPrice7d: null,
		avgPrice30d: null,
		avgPrice90d: null,
		volatility30d: null,
		cheapHours: {},
		expensiveHours: {},
		priceSource,
		error: message,
	};
}

export function disabledResult(): PriceLearningResult {
	return {
		status: "disabled",
		health: "error",
		confidence: 0,
		sampleDays: 0,
		coveragePct: 0,
		missingDays: 0,
		avgPrice7d: null,
		avgPrice30d: null,
		avgPrice90d: null,
		volatility30d: null,
		cheapHours: {},
		expensiveHours: {},
		priceSource: "",
		error: "Price Learning in Admin deaktiviert.",
	};
}

export function missingMappingResult(): PriceLearningResult {
	return {
		status: "missing_mapping",
		health: "error",
		confidence: 0,
		sampleDays: 0,
		coveragePct: 0,
		missingDays: 0,
		avgPrice7d: null,
		avgPrice30d: null,
		avgPrice90d: null,
		volatility30d: null,
		cheapHours: {},
		expensiveHours: {},
		priceSource: "",
		error: "Keine Preis-Quelle konfiguriert.",
	};
}

import {
	CONFIDENCE_PCT,
	PLAUSIBILITY,
	WEATHER_CONFIDENCE_HIGH_MIN_HOURS,
	WEATHER_CONFIDENCE_LOW_MIN_HOURS,
	WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS,
	WEATHER_HEALTH_OK_MIN_HOURS,
	WEATHER_HEALTH_WARNING_MIN_HOURS,
	WEATHER_MIN_VALID_DAY_HOURS,
	type WeatherMetricKey,
} from "./constants";
import type {
	WeatherComputeResult,
	WeatherConfidenceLevel,
	WeatherDayResult,
	WeatherHealthLevel,
	WeatherMetricMapping,
} from "./types";

/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte sind gültig. */
export function isValidMetricValue(key: WeatherMetricKey, value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	const bounds = PLAUSIBILITY[key];
	return value >= bounds.min && value <= bounds.max;
}

export function metricBias(actual: number, forecast: number): number {
	return actual - forecast;
}

export function meanOrNull(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	return values.reduce((a, b) => a + b, 0) / values.length;
}

export function confidenceFromValidHours(validHours: number): WeatherConfidenceLevel {
	if (validHours >= WEATHER_CONFIDENCE_HIGH_MIN_HOURS) {
		return "high";
	}
	if (validHours >= WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS) {
		return "medium";
	}
	if (validHours >= WEATHER_CONFIDENCE_LOW_MIN_HOURS) {
		return "low";
	}
	return "none";
}

export function healthFromValidHours(validHours: number): WeatherHealthLevel {
	if (validHours >= WEATHER_HEALTH_OK_MIN_HOURS) {
		return "ok";
	}
	if (validHours >= WEATHER_HEALTH_WARNING_MIN_HOURS) {
		return "warning";
	}
	return "error";
}

export function buildSummaryYesterday(day: WeatherDayResult | null): string {
	if (!day || day.validHours < WEATHER_MIN_VALID_DAY_HOURS) {
		return "Gestern kein ausreichender Forecast↔Ist-Vergleich.";
	}
	const parts: string[] = [];
	if (day.metrics.temp?.bias !== null && day.metrics.temp?.bias !== undefined) {
		parts.push(`Temp ${day.metrics.temp.bias >= 0 ? "+" : ""}${round(day.metrics.temp.bias, 1)}°C`);
	}
	if (day.metrics.cloud?.bias !== null && day.metrics.cloud?.bias !== undefined) {
		parts.push(`Wolken ${day.metrics.cloud.bias >= 0 ? "+" : ""}${round(day.metrics.cloud.bias, 1)}%`);
	}
	if (day.metrics.rain?.bias !== null && day.metrics.rain?.bias !== undefined) {
		parts.push(`Regen ${day.metrics.rain.bias >= 0 ? "+" : ""}${round(day.metrics.rain.bias, 2)}mm`);
	}
	if (day.metrics.wind?.bias !== null && day.metrics.wind?.bias !== undefined) {
		parts.push(`Wind ${day.metrics.wind.bias >= 0 ? "+" : ""}${round(day.metrics.wind.bias, 2)} km/h`);
	}
	if (parts.length === 0) {
		return `Gestern ${day.validHours}h vergleichbar, aber keine Metrik-Bias berechenbar.`;
	}
	return `Gestern ${day.validHours}h vergleichbar: ${parts.join(", ")}.`;
}

function round(n: number, digits: number): number {
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

export function computeWeatherLearning(
	dayResults: WeatherDayResult[],
	configuredMetrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>>,
	yesterday: WeatherDayResult | null,
	forecastSource: string,
	actualSource: string,
): WeatherComputeResult {
	const configuredKeys = Object.keys(configuredMetrics) as WeatherMetricKey[];
	if (configuredKeys.length === 0) {
		return emptyResult("missing_mapping", forecastSource, actualSource, "Keine Forecast-/Ist-Mappings konfiguriert.");
	}

	const validDays7 = dayResults.filter(
		(d) => d.dayOffset <= 6 && d.validHours >= WEATHER_MIN_VALID_DAY_HOURS,
	);
	const validDays30 = dayResults.filter((d) => d.validHours >= WEATHER_MIN_VALID_DAY_HOURS);

	const aggregateBias = (key: WeatherMetricKey): number | null => {
		const vals: number[] = [];
		for (const day of validDays7) {
			const b = day.metrics[key]?.bias;
			if (b !== null && b !== undefined && Number.isFinite(b)) {
				vals.push(b);
			}
		}
		return meanOrNull(vals);
	};

	const validFields: WeatherMetricKey[] = [];
	const missingFields: WeatherMetricKey[] = [];
	for (const key of configuredKeys) {
		const bias = aggregateBias(key);
		if (bias !== null) {
			validFields.push(key);
		} else {
			missingFields.push(key);
		}
	}

	const refHours = yesterday?.validHours ?? validDays7[0]?.validHours ?? 0;
	const confidence = confidenceFromValidHours(refHours);
	const health = healthFromValidHours(refHours);
	const qualityLevel = confidence;

	let status: WeatherComputeResult["status"] = "ready";
	if (validDays7.length === 0) {
		status = "insufficient_data";
	}

	return {
		status,
		health,
		confidence,
		qualityLevel,
		confidencePct: CONFIDENCE_PCT[confidence],
		tempBiasC: aggregateBias("temp"),
		cloudBiasPct: aggregateBias("cloud"),
		rainBiasMm: aggregateBias("rain"),
		windBiasKmh: aggregateBias("wind"),
		sampleDays7d: validDays7.length,
		sampleDays30d: validDays30.length,
		validFields,
		missingFields,
		forecastSource,
		actualSource,
		summaryYesterday: buildSummaryYesterday(yesterday),
		error: "",
		yesterday,
	};
}

function emptyResult(
	status: WeatherComputeResult["status"],
	forecastSource: string,
	actualSource: string,
	error: string,
): WeatherComputeResult {
	return {
		status,
		health: "error",
		confidence: "none",
		qualityLevel: "none",
		confidencePct: 0,
		tempBiasC: null,
		cloudBiasPct: null,
		rainBiasMm: null,
		windBiasKmh: null,
		sampleDays7d: 0,
		sampleDays30d: 0,
		validFields: [],
		missingFields: [],
		forecastSource,
		actualSource,
		summaryYesterday: "",
		error,
		yesterday: null,
	};
}

export function errorResult(
	forecastSource: string,
	actualSource: string,
	message: string,
): WeatherComputeResult {
	return emptyResult("error", forecastSource, actualSource, message);
}

import type { WeatherMetricKey } from "./constants";

export type WeatherMetricMapping = {
	forecastStateId: string;
	actualStateId: string;
};

export type WeatherConfig = {
	enabled: boolean;
	intervalSec: number;
	metrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>>;
};

export type WeatherConfidenceLevel = "high" | "medium" | "low" | "none";
export type WeatherHealthLevel = "ok" | "warning" | "error";

export type WeatherDayMetricResult = {
	bias: number | null;
	validHours: number;
};

export type WeatherDayResult = {
	dateKey: string;
	dayOffset: number;
	validHours: number;
	metrics: Partial<Record<WeatherMetricKey, WeatherDayMetricResult>>;
	missingForecast: WeatherMetricKey[];
	missingActual: WeatherMetricKey[];
	confidence: WeatherConfidenceLevel;
	health: WeatherHealthLevel;
};

export type WeatherComputeResult = {
	status: "ready" | "insufficient_data" | "missing_mapping" | "error" | "disabled";
	health: WeatherHealthLevel;
	confidence: WeatherConfidenceLevel;
	qualityLevel: WeatherConfidenceLevel;
	confidencePct: number;
	tempBiasC: number | null;
	cloudBiasPct: number | null;
	rainBiasMm: number | null;
	windBiasKmh: number | null;
	sampleDays7d: number;
	sampleDays30d: number;
	validFields: WeatherMetricKey[];
	missingFields: WeatherMetricKey[];
	forecastSource: string;
	actualSource: string;
	summaryYesterday: string;
	error: string;
	yesterday: WeatherDayResult | null;
};

export type WeatherPersistDay = {
	date: string;
	module: "learning.weather.v1";
	forecast_source: string;
	actual_source: string;
	valid_hours: number;
	metrics: {
		temp_bias_c: number | null;
		cloud_bias_pct: number | null;
		rain_bias_mm: number | null;
		wind_bias_kmh: number | null;
	};
	missing: {
		forecast: string[];
		actual: string[];
	};
	confidence: WeatherConfidenceLevel;
	health: WeatherHealthLevel;
};

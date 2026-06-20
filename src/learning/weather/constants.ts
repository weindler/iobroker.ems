/** Kalendertag 00:00–23:59 — gleiche Regel wie PV-Learning. */
export const MS_PER_DAY = 86_400_000;

export const HISTORY_QUERY_TIMEOUT_MS = 8000;

/** Health nach valider Stundenanzahl (Kalendertag). */
export const WEATHER_HEALTH_OK_MIN_HOURS = 18;
export const WEATHER_HEALTH_WARNING_MIN_HOURS = 6;

/** Mindest-Stunden für einen gültigen Lerntag (7d/30d sample). */
export const WEATHER_MIN_VALID_DAY_HOURS = 6;

export const WEATHER_CONFIDENCE_HIGH_MIN_HOURS = 18;
export const WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS = 12;
export const WEATHER_CONFIDENCE_LOW_MIN_HOURS = 6;

export const DEFAULT_INTERVAL_SEC = 3600;

export const METRIC_KEYS = ["temp", "cloud", "rain", "wind"] as const;
export type WeatherMetricKey = (typeof METRIC_KEYS)[number];

/** Plausibilitätsgrenzen — Werte außerhalb gelten als missing. */
export const PLAUSIBILITY: Record<
	WeatherMetricKey,
	{ min: number; max: number }
> = {
	temp: { min: -60, max: 60 },
	cloud: { min: 0, max: 100 },
	rain: { min: 0, max: 500 },
	wind: { min: 0, max: 250 },
};

export const CONFIDENCE_PCT: Record<string, number> = {
	high: 85,
	medium: 60,
	low: 30,
	none: 0,
};

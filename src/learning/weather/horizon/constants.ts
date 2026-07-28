/**
 * Weather horizon Tag 1–7 (Tag 1 = heute), analog PV-Horizon.
 * BrightSky-Beispiel: Tag1 = daily.00 … Tag7 = daily.06.
 */
export const WEATHER_HORIZON_FIRST_DAY = 1;
export const WEATHER_HORIZON_LAST_DAY = 7;
export const WEATHER_HORIZON_DAY_COUNT = 7;
export const WEATHER_HORIZON_DAY_INDEXES = [1, 2, 3, 4, 5, 6, 7] as const;

export type WeatherHorizonDayIndex = (typeof WEATHER_HORIZON_DAY_INDEXES)[number];

/** Bias-Gewicht je Tag (Tag1 = voll, weiter abnehmend) — wie PV-Horizon. */
export const WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY: readonly number[] = [
	1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4,
];

/** EMA für neuen Tages-Bias-Sample. */
export const WEATHER_HORIZON_BIAS_EMA_ALPHA = 0.3;

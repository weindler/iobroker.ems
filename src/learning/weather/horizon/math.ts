import {
	WEATHER_HORIZON_BIAS_EMA_ALPHA,
	WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY,
} from "./constants";

/** Effektiver Bias °C nach Tages-Gewichtung (dayIndex 1 = heute). */
export function effectiveTempBiasC(biasC: number, dayIndex: number): number {
	const weight =
		WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY[dayIndex - 1] ?? WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY.at(-1)!;
	return biasC * weight;
}

/** Korrigierte Temperatur = Roh + effektiver Bias (nie erfinden — nur wenn raw endlich). */
export function correctHorizonTempC(
	rawTempC: number | null,
	biasC: number | null,
	dayIndex: number,
): number | null {
	if (rawTempC === null || !Number.isFinite(rawTempC)) {
		return null;
	}
	if (biasC === null || !Number.isFinite(biasC)) {
		return rawTempC;
	}
	return Math.round((rawTempC + effectiveTempBiasC(biasC, dayIndex)) * 100) / 100;
}

export function emaBiasC(previous: number | null, sample: number): number {
	if (previous === null || !Number.isFinite(previous)) {
		return Math.round(sample * 100) / 100;
	}
	const next = WEATHER_HORIZON_BIAS_EMA_ALPHA * sample + (1 - WEATHER_HORIZON_BIAS_EMA_ALPHA) * previous;
	return Math.round(next * 100) / 100;
}

/** Bias = Ist − Forecast (wie Weather-Learning metricBias). */
export function dailyTempBiasSample(actualC: number, forecastC: number): number {
	return actualC - forecastC;
}

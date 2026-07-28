"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyTempBiasSample = exports.emaBiasC = exports.correctHorizonTempC = exports.effectiveTempBiasC = void 0;
const constants_1 = require("./constants");
/** Effektiver Bias °C nach Tages-Gewichtung (dayIndex 1 = heute). */
function effectiveTempBiasC(biasC, dayIndex) {
    const weight = constants_1.WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY[dayIndex - 1] ?? constants_1.WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY.at(-1);
    return biasC * weight;
}
exports.effectiveTempBiasC = effectiveTempBiasC;
/** Korrigierte Temperatur = Roh + effektiver Bias (nie erfinden — nur wenn raw endlich). */
function correctHorizonTempC(rawTempC, biasC, dayIndex) {
    if (rawTempC === null || !Number.isFinite(rawTempC)) {
        return null;
    }
    if (biasC === null || !Number.isFinite(biasC)) {
        return rawTempC;
    }
    return Math.round((rawTempC + effectiveTempBiasC(biasC, dayIndex)) * 100) / 100;
}
exports.correctHorizonTempC = correctHorizonTempC;
function emaBiasC(previous, sample) {
    if (previous === null || !Number.isFinite(previous)) {
        return Math.round(sample * 100) / 100;
    }
    const next = constants_1.WEATHER_HORIZON_BIAS_EMA_ALPHA * sample + (1 - constants_1.WEATHER_HORIZON_BIAS_EMA_ALPHA) * previous;
    return Math.round(next * 100) / 100;
}
exports.emaBiasC = emaBiasC;
/** Bias = Ist − Forecast (wie Weather-Learning metricBias). */
function dailyTempBiasSample(actualC, forecastC) {
    return actualC - forecastC;
}
exports.dailyTempBiasSample = dailyTempBiasSample;

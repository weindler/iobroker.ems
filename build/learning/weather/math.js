"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.computeWeatherLearning = exports.buildSummaryYesterday = exports.healthFromValidHours = exports.confidenceFromValidHours = exports.meanOrNull = exports.metricBias = exports.isValidMetricValue = void 0;
const constants_1 = require("./constants");
/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte sind gültig. */
function isValidMetricValue(key, value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    const bounds = constants_1.PLAUSIBILITY[key];
    return value >= bounds.min && value <= bounds.max;
}
exports.isValidMetricValue = isValidMetricValue;
function metricBias(actual, forecast) {
    return actual - forecast;
}
exports.metricBias = metricBias;
function meanOrNull(values) {
    if (values.length === 0) {
        return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}
exports.meanOrNull = meanOrNull;
function confidenceFromValidHours(validHours) {
    if (validHours >= constants_1.WEATHER_CONFIDENCE_HIGH_MIN_HOURS) {
        return "high";
    }
    if (validHours >= constants_1.WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS) {
        return "medium";
    }
    if (validHours >= constants_1.WEATHER_CONFIDENCE_LOW_MIN_HOURS) {
        return "low";
    }
    return "none";
}
exports.confidenceFromValidHours = confidenceFromValidHours;
function healthFromValidHours(validHours) {
    if (validHours >= constants_1.WEATHER_HEALTH_OK_MIN_HOURS) {
        return "ok";
    }
    if (validHours >= constants_1.WEATHER_HEALTH_WARNING_MIN_HOURS) {
        return "warning";
    }
    return "error";
}
exports.healthFromValidHours = healthFromValidHours;
function buildSummaryYesterday(day) {
    if (!day || day.validHours < constants_1.WEATHER_MIN_VALID_DAY_HOURS) {
        return "Gestern kein ausreichender Forecast↔Ist-Vergleich.";
    }
    const parts = [];
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
        parts.push(`Wind ${day.metrics.wind.bias >= 0 ? "+" : ""}${round(day.metrics.wind.bias, 2)}m/s`);
    }
    if (parts.length === 0) {
        return `Gestern ${day.validHours}h vergleichbar, aber keine Metrik-Bias berechenbar.`;
    }
    return `Gestern ${day.validHours}h vergleichbar: ${parts.join(", ")}.`;
}
exports.buildSummaryYesterday = buildSummaryYesterday;
function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
function computeWeatherLearning(dayResults, configuredMetrics, yesterday, forecastSource, actualSource) {
    const configuredKeys = Object.keys(configuredMetrics);
    if (configuredKeys.length === 0) {
        return emptyResult("missing_mapping", forecastSource, actualSource, "Keine Forecast-/Ist-Mappings konfiguriert.");
    }
    const validDays7 = dayResults.filter((d) => d.dayOffset <= 6 && d.validHours >= constants_1.WEATHER_MIN_VALID_DAY_HOURS);
    const validDays30 = dayResults.filter((d) => d.validHours >= constants_1.WEATHER_MIN_VALID_DAY_HOURS);
    const aggregateBias = (key) => {
        const vals = [];
        for (const day of validDays7) {
            const b = day.metrics[key]?.bias;
            if (b !== null && b !== undefined && Number.isFinite(b)) {
                vals.push(b);
            }
        }
        return meanOrNull(vals);
    };
    const validFields = [];
    const missingFields = [];
    for (const key of configuredKeys) {
        const bias = aggregateBias(key);
        if (bias !== null) {
            validFields.push(key);
        }
        else {
            missingFields.push(key);
        }
    }
    const refHours = yesterday?.validHours ?? validDays7[0]?.validHours ?? 0;
    const confidence = confidenceFromValidHours(refHours);
    const health = healthFromValidHours(refHours);
    const qualityLevel = confidence;
    let status = "ready";
    if (validDays7.length === 0) {
        status = "insufficient_data";
    }
    return {
        status,
        health,
        confidence,
        qualityLevel,
        confidencePct: constants_1.CONFIDENCE_PCT[confidence],
        tempBiasC: aggregateBias("temp"),
        cloudBiasPct: aggregateBias("cloud"),
        rainBiasMm: aggregateBias("rain"),
        windBiasMs: aggregateBias("wind"),
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
exports.computeWeatherLearning = computeWeatherLearning;
function emptyResult(status, forecastSource, actualSource, error) {
    return {
        status,
        health: "error",
        confidence: "none",
        qualityLevel: "none",
        confidencePct: 0,
        tempBiasC: null,
        cloudBiasPct: null,
        rainBiasMm: null,
        windBiasMs: null,
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
function errorResult(forecastSource, actualSource, message) {
    return emptyResult("error", forecastSource, actualSource, message);
}
exports.errorResult = errorResult;

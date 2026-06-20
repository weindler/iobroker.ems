"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.missingForecastResult = exports.disabledResult = exports.computePriceForecastLearning = exports.healthFromMetrics = exports.computeForecastConfidence = exports.stabilityFromDailyAccuracy = exports.accuracyFromAvgErrorCt = exports.stdDev = exports.meanOrNull = void 0;
const constants_1 = require("./constants");
function meanOrNull(values) {
    if (values.length === 0)
        return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}
exports.meanOrNull = meanOrNull;
function stdDev(values) {
    if (values.length < 2)
        return null;
    const mean = meanOrNull(values);
    if (mean === null)
        return null;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
exports.stdDev = stdDev;
/** Einfache transparente Accuracy: 100 − avgAbsErrorCt × 10 (geclippt 0–100). */
function accuracyFromAvgErrorCt(avgErrorCt) {
    if (avgErrorCt === null || !Number.isFinite(avgErrorCt))
        return null;
    return Math.round(Math.max(0, Math.min(100, 100 - avgErrorCt * constants_1.ACCURACY_ERROR_SCALE)));
}
exports.accuracyFromAvgErrorCt = accuracyFromAvgErrorCt;
function stabilityFromDailyAccuracy(dailyAccuracies) {
    if (dailyAccuracies.length < 3)
        return "unknown";
    const sd = stdDev(dailyAccuracies);
    if (sd === null)
        return "unknown";
    if (sd <= 5)
        return "stable";
    if (sd <= 12)
        return "normal";
    return "volatile";
}
exports.stabilityFromDailyAccuracy = stabilityFromDailyAccuracy;
function pairsWithinDays(pairs, maxDayOffset, now) {
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - maxDayOffset);
    const cutoffMs = cutoff.getTime();
    return pairs.filter((p) => p.hourStartMs >= cutoffMs);
}
function dailyGroups(pairs) {
    const map = new Map();
    for (const p of pairs) {
        const list = map.get(p.targetDate) ?? [];
        list.push(p);
        map.set(p.targetDate, list);
    }
    return map;
}
function validSampleDays(groups) {
    return [...groups.entries()]
        .filter(([, list]) => list.length >= constants_1.MIN_MATCHED_HOURS_PER_DAY)
        .map(([date]) => date);
}
function computeForecastConfidence(params) {
    let score = 0;
    score += Math.min(40, (params.sampleDays / Math.max(1, params.lookbackDays)) * 40);
    score += (Math.min(100, params.coveragePct) / 100) * 30;
    if (params.avgAccuracy90d !== null) {
        score += (params.avgAccuracy90d / 100) * 20;
    }
    if (params.stability === "stable")
        score += 10;
    else if (params.stability === "normal")
        score += 6;
    else if (params.stability === "volatile")
        score += 2;
    return Math.round(Math.max(0, Math.min(100, score)));
}
exports.computeForecastConfidence = computeForecastConfidence;
function healthFromMetrics(sampleDays, coveragePct) {
    if (sampleDays >= 30 && coveragePct >= 80)
        return "ok";
    if (sampleDays >= 7 && coveragePct >= 50)
        return "warning";
    return "error";
}
exports.healthFromMetrics = healthFromMetrics;
function computePriceForecastLearning(allPairs, lookbackDays, forecastSource, actualSource, now) {
    const groups = dailyGroups(allPairs);
    const validDates = validSampleDays(groups);
    const expectedDays = lookbackDays;
    const missingDays = Math.max(0, expectedDays - validDates.length);
    const coveragePct = expectedDays > 0 ? Math.round((validDates.length / expectedDays) * 1000) / 10 : 0;
    const windowPairs = (maxOffset) => pairsWithinDays(allPairs, maxOffset, now);
    const errorsInWindow = (maxOffset) => windowPairs(maxOffset).map((p) => p.absErrorCt);
    const avgErr7 = meanOrNull(errorsInWindow(6));
    const avgErr30 = meanOrNull(errorsInWindow(29));
    const avgErr90 = meanOrNull(errorsInWindow(lookbackDays - 1));
    const acc7 = accuracyFromAvgErrorCt(avgErr7);
    const acc30 = accuracyFromAvgErrorCt(avgErr30);
    const acc90 = accuracyFromAvgErrorCt(avgErr90);
    const dailyAccuracies = [];
    for (const date of validDates) {
        const dayPairs = groups.get(date) ?? [];
        const dayErr = meanOrNull(dayPairs.map((p) => p.absErrorCt));
        const dayAcc = accuracyFromAvgErrorCt(dayErr);
        if (dayAcc !== null)
            dailyAccuracies.push(dayAcc);
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
    let status = "ready";
    if (validDates.length === 0) {
        status = "insufficient_data";
    }
    else if (validDates.length < constants_1.MIN_SAMPLE_DAYS_READY || forecastConfidence < 50) {
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
exports.computePriceForecastLearning = computePriceForecastLearning;
function disabledResult() {
    return emptyResult("disabled", "", "", "Price Forecast Learning in Admin deaktiviert.");
}
exports.disabledResult = disabledResult;
function missingForecastResult() {
    return emptyResult("missing_forecast", "", "", "Forecast- und Ist-State konfigurieren (PricesToday/PricesTomorrow.json + CurrentPrice.total).");
}
exports.missingForecastResult = missingForecastResult;
function errorResult(forecastSource, actualSource, message) {
    return emptyResult("error", forecastSource, actualSource, message);
}
exports.errorResult = errorResult;
function emptyResult(status, forecastSource, actualSource, error) {
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

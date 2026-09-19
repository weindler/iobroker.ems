"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missingMappingResult = exports.disabledResult = exports.errorResult = exports.computePriceLearning = exports.computeConfidence = exports.healthFromMetrics = exports.computeCoverage = exports.buildHourPatterns = exports.robustWeightedMean = exports.volatilityCoefficient = exports.stdDev = exports.meanOrNull = void 0;
const constants_1 = require("./constants");
function meanOrNull(values) {
    if (values.length === 0) {
        return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}
exports.meanOrNull = meanOrNull;
function stdDev(values) {
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
exports.stdDev = stdDev;
function volatilityCoefficient(values) {
    const mean = meanOrNull(values);
    const sd = stdDev(values);
    if (mean === null || sd === null || mean <= 0) {
        return null;
    }
    return sd / mean;
}
exports.volatilityCoefficient = volatilityCoefficient;
function validDaySummaries(days) {
    return days.filter((d) => d.validHours >= constants_1.MIN_VALID_HOURS_PER_DAY && d.avgPriceEur !== null);
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
/**
 * Robuster Huber-Mittelwert. Jeder technisch gültige Wert bleibt beteiligt;
 * große Abstände erhalten lediglich weniger Einfluss auf die Modellmitte.
 */
function robustWeightedMean(values) {
    const finite = values.filter((v) => Number.isFinite(v.value) && v.weight > 0);
    if (finite.length === 0)
        return null;
    const center = median(finite.map((v) => v.value));
    if (center === null)
        return null;
    const mad = median(finite.map((v) => Math.abs(v.value - center))) ?? 0;
    const scale = Math.max(mad * 1.4826, 0.001);
    const huberLimit = 2.5 * scale;
    let weightedSum = 0;
    let weightSum = 0;
    for (const item of finite) {
        const distance = Math.abs(item.value - center);
        const robustWeight = distance > huberLimit ? huberLimit / distance : 1;
        const weight = item.weight * robustWeight;
        weightedSum += item.value * weight;
        weightSum += weight;
    }
    return weightSum > 0 ? weightedSum / weightSum : null;
}
exports.robustWeightedMean = robustWeightedMean;
function avgForWindow(validDays, maxDayOffset, doubleRecent = false) {
    const prices = validDays
        .filter((d) => d.dayOffset <= maxDayOffset && d.avgPriceEur !== null)
        .map((d) => ({
        value: d.avgPriceEur,
        weight: doubleRecent && d.dayOffset < constants_1.RECENT_DOUBLE_WEIGHT_DAYS ? 2 : 1,
    }));
    return robustWeightedMean(prices);
}
function buildHourPatterns(samples, topN = constants_1.HOUR_PATTERN_TOP_N) {
    const byHour = new Map();
    const recentCutoff = Date.now() - constants_1.RECENT_DOUBLE_WEIGHT_DAYS * 86_400_000;
    for (const s of samples) {
        const list = byHour.get(s.hourOfDay) ?? [];
        list.push({ value: s.priceEur, weight: s.ts >= recentCutoff ? 2 : 1 });
        byHour.set(s.hourOfDay, list);
    }
    const hourMeans = [];
    for (const [hour, prices] of byHour.entries()) {
        const mean = robustWeightedMean(prices);
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
    const cheapnessScore = (mean) => {
        if (span <= 0) {
            return 0.5;
        }
        return round(1 - (mean - minMean) / span, 2);
    };
    const expensivenessScore = (mean) => {
        if (span <= 0) {
            return 0.5;
        }
        return round((mean - minMean) / span, 2);
    };
    const sortedCheap = [...hourMeans]
        .sort((a, b) => a.mean - b.mean)
        .slice(0, topN);
    const sortedExpensive = [...hourMeans]
        .sort((a, b) => b.mean - a.mean)
        .slice(0, topN);
    const cheapHours = {};
    for (const h of sortedCheap) {
        cheapHours[String(h.hour)] = cheapnessScore(h.mean);
    }
    const expensiveHours = {};
    for (const h of sortedExpensive) {
        expensiveHours[String(h.hour)] = expensivenessScore(h.mean);
    }
    return { cheapHours, expensiveHours };
}
exports.buildHourPatterns = buildHourPatterns;
function computeCoverage(validDays, lookbackDays) {
    const expected = lookbackDays;
    const covered = validDays.length;
    const missingDays = Math.max(0, expected - covered);
    const coveragePct = expected > 0 ? round((covered / expected) * 100, 1) : 0;
    return { coveragePct, missingDays };
}
exports.computeCoverage = computeCoverage;
function healthFromMetrics(sampleDays, coveragePct) {
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
exports.healthFromMetrics = healthFromMetrics;
function computeConfidence(params) {
    let score = 0;
    const sampleRatio = Math.min(1, params.sampleDays / Math.max(1, params.lookbackDays));
    score += sampleRatio * 40;
    score += (Math.min(100, params.coveragePct) / 100) * 40;
    if (params.volatility30d !== null) {
        const volPenalty = Math.min(1, params.volatility30d / 0.5);
        score += (1 - volPenalty) * 20;
    }
    else {
        score += 5;
    }
    return Math.round(Math.min(100, Math.max(0, score)));
}
exports.computeConfidence = computeConfidence;
function round(n, digits) {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
function computePriceLearning(samples, daySummaries, lookbackDays, priceSource) {
    const validDays = validDaySummaries(daySummaries);
    const { coveragePct, missingDays } = computeCoverage(validDays, lookbackDays);
    const avgPrice7d = avgForWindow(validDays, 6);
    const avgPrice30d = avgForWindow(validDays, 29);
    const avgPrice90d = avgForWindow(validDays, 89);
    const avgPrice24m = avgForWindow(validDays, lookbackDays - 1, true);
    const last30Daily = validDays
        .filter((d) => d.dayOffset <= 29)
        .map((d) => d.avgPriceEur)
        .filter((v) => v !== null);
    const volatility30d = volatilityCoefficient(last30Daily);
    const { cheapHours, expensiveHours } = buildHourPatterns(samples);
    const confidence = computeConfidence({
        sampleDays: validDays.length,
        lookbackDays,
        coveragePct,
        volatility30d,
    });
    const health = healthFromMetrics(validDays.length, coveragePct);
    let status = "ready";
    if (validDays.length === 0) {
        status = "insufficient_data";
    }
    else if (validDays.length < constants_1.MIN_SAMPLE_DAYS_READY || confidence < 50) {
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
        avgPrice24m,
        volatility30d,
        cheapHours,
        expensiveHours,
        priceSource,
        error: "",
    };
}
exports.computePriceLearning = computePriceLearning;
function errorResult(priceSource, message) {
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
        avgPrice24m: null,
        volatility30d: null,
        cheapHours: {},
        expensiveHours: {},
        priceSource,
        error: message,
    };
}
exports.errorResult = errorResult;
function disabledResult() {
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
        avgPrice24m: null,
        volatility30d: null,
        cheapHours: {},
        expensiveHours: {},
        priceSource: "",
        error: "Price Learning in Admin deaktiviert.",
    };
}
exports.disabledResult = disabledResult;
function missingMappingResult() {
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
        avgPrice24m: null,
        volatility30d: null,
        cheapHours: {},
        expensiveHours: {},
        priceSource: "",
        error: "Keine Preis-Quelle konfiguriert.",
    };
}
exports.missingMappingResult = missingMappingResult;

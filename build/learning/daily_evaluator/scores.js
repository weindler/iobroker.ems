"use strict";
/**
 * BLOCK A — Domain-Scores + GlobalScore.
 *
 * GlobalScore ist zunächst gleichgewichtet über tatsächlich evaluierbare Score-Topics
 * (Korrektur #8) — nicht anwendbare/insufficient Topics fließen nicht ein. Die verwendeten
 * normalisierten Gewichte werden im EvaluationRecord persistiert (Nachvollziehbarkeit).
 *
 * comfortScore bleibt bewusst null — es gibt keine Komfort-/Temperatur-Telemetrie für
 * Klimaräume in day_telemetry (keine erfundene Zahl).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGlobalScore = exports.computeDomainScores = void 0;
const types_1 = require("./types");
const CLASSIFICATION_SCORE = {
    mandatory: 100,
    necessary: 100,
    reasonable: 100,
    early: 80,
    avoidable: 50,
    wasteful: 0,
    unknown: null,
};
function sum(arr) {
    let s = 0;
    for (const v of arr)
        if (v != null && Number.isFinite(v))
            s += v;
    return s;
}
function avgClassificationScore(findings) {
    const usable = findings.filter((f) => !f.insufficientData);
    const scores = usable
        .map((f) => CLASSIFICATION_SCORE[f.quality.outcomeQuality])
        .filter((v) => v != null);
    if (scores.length === 0)
        return { value: null, sampleCount: 0 };
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { value: Math.round(avg * 10) / 10, sampleCount: scores.length };
}
function batteryScore(findings) {
    const checks = findings.filter((f) => f.domain === "battery" && f.eventType === "battery_reserve_check" && !f.insufficientData);
    if (checks.length === 0) {
        return { topic: types_1.SCORE_TOPIC.BATTERY, value: null, sampleCount: 0, basis: "no_conclusive_reserve_checks" };
    }
    const held = checks.filter((f) => f.reasonCodes.includes("reserve_held")).length;
    const value = Math.round((held / checks.length) * 1000) / 10;
    return { topic: types_1.SCORE_TOPIC.BATTERY, value, sampleCount: checks.length, basis: "reserve_held_ratio" };
}
function thermalScore(findings) {
    const r = avgClassificationScore(findings.filter((f) => f.domain === "thermal"));
    return { topic: types_1.SCORE_TOPIC.THERMAL, value: r.value, sampleCount: r.sampleCount, basis: "outcome_classification_avg" };
}
function climateScore(findings) {
    const r = avgClassificationScore(findings.filter((f) => f.domain === "climate"));
    return { topic: types_1.SCORE_TOPIC.CLIMATE, value: r.value, sampleCount: r.sampleCount, basis: "outcome_classification_avg" };
}
function evScore(findings) {
    const checks = findings.filter((f) => f.domain === "ev" && f.eventType === "ev_readiness_check" && !f.insufficientData);
    if (checks.length === 0) {
        return { topic: types_1.SCORE_TOPIC.EV, value: null, sampleCount: 0, basis: "no_conclusive_readiness_checks" };
    }
    const met = checks.filter((f) => f.reasonCodes.includes("ev_readiness_met")).length;
    const value = Math.round((met / checks.length) * 1000) / 10;
    return { topic: types_1.SCORE_TOPIC.EV, value, sampleCount: checks.length, basis: "readiness_met_ratio" };
}
/** Rein deskriptiv aus Telemetrie — kein Bezug zu Findings/Attribution. */
function pvUtilizationScore(day) {
    const pv = sum(day.buckets.pvKwh);
    if (pv <= 0) {
        return { topic: types_1.SCORE_TOPIC.PV, value: null, sampleCount: 0, basis: "no_pv_production" };
    }
    const exportKwh = sum(day.buckets.gridExportKwh);
    const selfConsumed = Math.max(0, pv - exportKwh);
    const value = Math.round((selfConsumed / pv) * 1000) / 10;
    return { topic: types_1.SCORE_TOPIC.PV, value: Math.min(100, value), sampleCount: 1, basis: "self_consumed_share_of_pv" };
}
/** Preis-Timing der Hauslast relativ zur tatsächlichen Tages-Preisverteilung — rein deskriptiv. */
function priceEfficiencyScore(day) {
    const prices = day.buckets.priceCtPerKwh;
    const loads = day.buckets.houseTotalKwh;
    const validPrices = prices.filter((v) => v != null && Number.isFinite(v));
    if (validPrices.length < 4) {
        return { topic: types_1.SCORE_TOPIC.PRICE, value: null, sampleCount: 0, basis: "insufficient_price_samples" };
    }
    const sorted = [...validPrices].sort((a, b) => a - b);
    let weightedPercentileSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < prices.length; i++) {
        const p = prices[i];
        const l = loads[i];
        if (p == null || l == null || !(l > 0))
            continue;
        let below = 0;
        for (const v of sorted)
            if (v < p)
                below++;
        const percentile = below / sorted.length;
        weightedPercentileSum += percentile * l;
        weightTotal += l;
    }
    if (weightTotal <= 0) {
        return { topic: types_1.SCORE_TOPIC.PRICE, value: null, sampleCount: 0, basis: "no_weighted_consumption" };
    }
    const avgPercentile = weightedPercentileSum / weightTotal;
    const value = Math.round((1 - avgPercentile) * 1000) / 10;
    return { topic: types_1.SCORE_TOPIC.PRICE, value, sampleCount: 1, basis: "consumption_weighted_price_percentile" };
}
function comfortScore() {
    return { topic: types_1.SCORE_TOPIC.COMFORT, value: null, sampleCount: 0, basis: "no_comfort_telemetry_available" };
}
function computeDomainScores(day, findings) {
    return [
        batteryScore(findings),
        thermalScore(findings),
        climateScore(findings),
        evScore(findings),
        pvUtilizationScore(day),
        priceEfficiencyScore(day),
        comfortScore(),
    ];
}
exports.computeDomainScores = computeDomainScores;
function computeGlobalScore(scores) {
    const usable = scores.filter((s) => s.value != null);
    if (usable.length === 0)
        return { globalScore: null, weights: {} };
    const weight = Math.round((1 / usable.length) * 10000) / 10000;
    const weights = {};
    let acc = 0;
    for (const s of usable) {
        weights[s.topic] = weight;
        acc += s.value * weight;
    }
    /* Rundungsdrift ausgleichen: letztes Topic erhält Restgewicht statt kumulativer Abweichung. */
    const topics = Object.keys(weights);
    const weightSum = topics.reduce((a, t) => a + weights[t], 0);
    if (topics.length > 0 && Math.abs(weightSum - 1) > 1e-9) {
        const last = topics[topics.length - 1];
        weights[last] = Math.round((weights[last] + (1 - weightSum)) * 10000) / 10000;
    }
    let recompute = 0;
    for (const s of usable)
        recompute += s.value * weights[s.topic];
    return { globalScore: Math.round(recompute * 10) / 10, weights };
}
exports.computeGlobalScore = computeGlobalScore;

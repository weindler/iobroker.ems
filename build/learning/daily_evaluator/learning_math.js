"use strict";
/**
 * BLOCK A — reine Statistik-Helfer für den diagnostischen Learning-State.
 * Bewusst eigenständig (kein Import aus pv_bias/battery_runtime/house_load) — Block A
 * bleibt vollständig von aktivem Learning entkoppelt.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateLearningMetric = exports.confidenceFromSampleCount = exports.LEARNING_MIN_SAMPLES_FOR_CONFIDENCE = void 0;
exports.LEARNING_MIN_SAMPLES_FOR_CONFIDENCE = 5;
function confidenceFromSampleCount(n, targetSamples) {
    if (n < exports.LEARNING_MIN_SAMPLES_FOR_CONFIDENCE)
        return null;
    return Math.round(Math.min(1, n / targetSamples) * 100);
}
exports.confidenceFromSampleCount = confidenceFromSampleCount;
/**
 * Online-Update (Welford) für Mittelwert/Varianz — kein voller History-Speicher nötig,
 * bleibt ein kompakter Zustand pro Metrik.
 */
function updateLearningMetric(prev, newValue, atIso, targetSamplesForConfidence) {
    if (!Number.isFinite(newValue))
        return prev;
    const n = prev.sampleCount + 1;
    const prevMean = prev.value ?? newValue;
    const delta = newValue - prevMean;
    const mean = prevMean + delta / n;
    const prevM2 = prev.variance != null && prev.sampleCount > 1 ? prev.variance * (prev.sampleCount - 1) : 0;
    const m2 = prevM2 + delta * (newValue - mean);
    const variance = n > 1 ? m2 / n : 0;
    return {
        value: Math.round(mean * 1000) / 1000,
        sampleCount: n,
        confidence: confidenceFromSampleCount(n, targetSamplesForConfidence),
        updatedAtIso: atIso,
        periodStartIso: prev.periodStartIso ?? atIso,
        periodEndIso: atIso,
        min: prev.min == null ? newValue : Math.min(prev.min, newValue),
        max: prev.max == null ? newValue : Math.max(prev.max, newValue),
        variance: Math.round(variance * 1000) / 1000,
        reasonDe: `Aktualisiert aus ${n} Sample(n), zuletzt am ${atIso}.`,
    };
}
exports.updateLearningMetric = updateLearningMetric;

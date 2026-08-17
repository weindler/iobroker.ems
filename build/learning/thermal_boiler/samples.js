"use strict";
/**
 * Lokale Boiler-Temperaturhistorie — unabhängig von vollständigen Heizstab-Zyklen.
 * Getrennt von Puffer `thermal_runtime`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTimeoutFallback = exports.historyJsonFromBoilerPoints = exports.mergeBoilerTempPoints = exports.trimBoilerTempSamples = exports.appendBoilerTempSample = exports.BOILER_HISTORY_JSON_SAMPLES = exports.BOILER_HISTORY_FETCH_LOOKBACK_DAYS = exports.BOILER_HISTORY_FETCH_TIMEOUT_MS = exports.BOILER_MAX_TEMP_SAMPLES = exports.BOILER_SAMPLE_MIN_DELTA_C = exports.BOILER_SAMPLE_MIN_INTERVAL_MS = void 0;
const history_1 = require("../thermal_runtime/history");
exports.BOILER_SAMPLE_MIN_INTERVAL_MS = 10 * 60 * 1000;
exports.BOILER_SAMPLE_MIN_DELTA_C = 0.3;
/** ~90 Tage bei stündlichem Takt — reicht für Newton, ohne Persist-Sturm. */
exports.BOILER_MAX_TEMP_SAMPLES = 2_200;
exports.BOILER_HISTORY_FETCH_TIMEOUT_MS = 20_000;
/** Bulk-Pfad (≤7d): darf die gemeinsame History-Queue nicht mit 90-Tage-Chunks blockieren. */
exports.BOILER_HISTORY_FETCH_LOOKBACK_DAYS = 7;
exports.BOILER_HISTORY_JSON_SAMPLES = 80;
const MS_PER_DAY = 86_400_000;
function appendBoilerTempSample(prev, sample, nowMs, lookbackDays) {
    if (!(0, history_1.isValidTempC)(sample.tempC) || !Number.isFinite(sample.ts) || sample.ts <= 0) {
        return trimBoilerTempSamples(prev, nowMs, lookbackDays);
    }
    const last = prev.length > 0 ? prev[prev.length - 1] : null;
    if (last) {
        const dt = sample.ts - last.ts;
        const dT = Math.abs(sample.tempC - last.tempC);
        if (dt >= 0 && dt < exports.BOILER_SAMPLE_MIN_INTERVAL_MS && dT < exports.BOILER_SAMPLE_MIN_DELTA_C) {
            return trimBoilerTempSamples(prev, nowMs, lookbackDays);
        }
    }
    return trimBoilerTempSamples([...prev, { ts: sample.ts, tempC: Math.round(sample.tempC * 100) / 100 }], nowMs, lookbackDays);
}
exports.appendBoilerTempSample = appendBoilerTempSample;
function trimBoilerTempSamples(points, nowMs, lookbackDays) {
    const lookbackMs = Math.max(1, lookbackDays) * MS_PER_DAY;
    const cutoff = nowMs - lookbackMs;
    const kept = points.filter((p) => p.ts >= cutoff && (0, history_1.isValidTempC)(p.tempC));
    if (kept.length <= exports.BOILER_MAX_TEMP_SAMPLES)
        return kept;
    return kept.slice(kept.length - exports.BOILER_MAX_TEMP_SAMPLES);
}
exports.trimBoilerTempSamples = trimBoilerTempSamples;
function mergeBoilerTempPoints(local, fromHistory) {
    const byTs = new Map();
    for (const p of [...fromHistory, ...local]) {
        if (!Number.isFinite(p.ts) || !(0, history_1.isValidTempC)(p.tempC))
            continue;
        byTs.set(p.ts, Math.round(p.tempC * 100) / 100);
    }
    return [...byTs.entries()]
        .map(([ts, tempC]) => ({ ts, tempC }))
        .sort((a, b) => a.ts - b.ts);
}
exports.mergeBoilerTempPoints = mergeBoilerTempPoints;
function historyJsonFromBoilerPoints(points) {
    if (points.length <= exports.BOILER_HISTORY_JSON_SAMPLES)
        return points;
    return points.slice(points.length - exports.BOILER_HISTORY_JSON_SAMPLES);
}
exports.historyJsonFromBoilerPoints = historyJsonFromBoilerPoints;
async function withTimeoutFallback(promise, timeoutMs, fallback) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
exports.withTimeoutFallback = withTimeoutFallback;

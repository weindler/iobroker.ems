"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWeatherDayResults = exports.evaluateWeatherDay = exports.fetchHourlyMap = exports.dateKeyFromOffset = exports.dayBoundsMs = exports.readStateNum = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const constants_1 = require("./constants");
const math_1 = require("./math");
function isForeignStateId(stateId) {
    return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}
async function readStateNum(host, stateId) {
    if (!stateId) {
        return null;
    }
    const tryRead = async (fn) => {
        if (!fn)
            return null;
        try {
            const st = await fn.call(host, stateId);
            return (0, state_util_1.asNum)(st?.val);
        }
        catch {
            return null;
        }
    };
    if (isForeignStateId(stateId)) {
        const foreign = await tryRead(host.getForeignStateAsync);
        if (foreign !== null)
            return foreign;
        return tryRead(host.getStateAsync);
    }
    const own = await tryRead(host.getStateAsync);
    if (own !== null)
        return own;
    return tryRead(host.getForeignStateAsync);
}
exports.readStateNum = readStateNum;
/** Lokale Mitternachtsgrenzen (dayOffset 0 = heute, 1 = gestern). */
function dayBoundsMs(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const start = d.getTime();
    return { start, end: start + constants_1.MS_PER_DAY };
}
exports.dayBoundsMs = dayBoundsMs;
function dateKeyFromOffset(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
exports.dateKeyFromOffset = dateKeyFromOffset;
function hourBucketMs(ts) {
    return Math.floor(ts / 3_600_000) * 3_600_000;
}
/** Stündliche Werte im Kalendertag (Bucket = Stundenanfang). */
async function fetchHourlyMap(host, stateId, startMs, endMs) {
    const map = new Map();
    if (!stateId)
        return map;
    const rows = await (0, history_query_1.fetchHistoryRowsInRange)(host, stateId, startMs, endMs, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || n === null)
            continue;
        map.set(hourBucketMs(ts), n);
    }
    return map;
}
exports.fetchHourlyMap = fetchHourlyMap;
async function evaluateWeatherDay(host, metrics, dayOffset) {
    const { start, end } = dayBoundsMs(dayOffset);
    const dateKey = dateKeyFromOffset(dayOffset);
    const keys = Object.keys(metrics);
    const hourlyByMetric = {};
    const missingForecast = [];
    const missingActual = [];
    for (const key of keys) {
        const mapping = metrics[key];
        if (!mapping)
            continue;
        const [forecastMap, actualMap] = await Promise.all([
            fetchHourlyMap(host, mapping.forecastStateId, start, end),
            fetchHourlyMap(host, mapping.actualStateId, start, end),
        ]);
        if (forecastMap.size === 0)
            missingForecast.push(key);
        if (actualMap.size === 0)
            missingActual.push(key);
        hourlyByMetric[key] = { forecast: forecastMap, actual: actualMap };
    }
    // Jede Metrik wird über ihre EIGENE Forecast∩Ist-Schnittmenge bewertet.
    // (Früher: globale Schnittmenge über alle Metriken — dadurch fiel z. B. Regen
    // weg, sobald seine Stunden nicht exakt mit Temp/Wind übereinstimmten.)
    const metricResults = {};
    let validHours = 0;
    for (const key of keys) {
        const pair = hourlyByMetric[key];
        if (!pair) {
            metricResults[key] = { bias: null, validHours: 0 };
            continue;
        }
        const diffs = [];
        for (const [h, f] of pair.forecast) {
            if (!pair.actual.has(h))
                continue;
            const a = pair.actual.get(h) ?? null;
            if (!(0, math_1.isValidMetricValue)(key, f) || !(0, math_1.isValidMetricValue)(key, a))
                continue;
            diffs.push((0, math_1.metricBias)(a, f));
        }
        metricResults[key] = {
            bias: diffs.length > 0 ? diffs.reduce((s, v) => s + v, 0) / diffs.length : null,
            validHours: diffs.length,
        };
        if (diffs.length > validHours)
            validHours = diffs.length;
    }
    return {
        dateKey,
        dayOffset,
        validHours,
        metrics: metricResults,
        missingForecast,
        missingActual,
        confidence: (0, math_1.confidenceFromValidHours)(validHours),
        health: (0, math_1.healthFromValidHours)(validHours),
    };
}
exports.evaluateWeatherDay = evaluateWeatherDay;
async function fetchWeatherDayResults(host, metrics, maxDays = 30) {
    const results = await Promise.all(Array.from({ length: maxDays }, (_, dayOffset) => evaluateWeatherDay(host, metrics, dayOffset)));
    return results;
}
exports.fetchWeatherDayResults = fetchWeatherDayResults;

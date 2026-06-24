"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSampleDays = exports.fetchHouseLoadSamples = exports.filterOutliers = exports.isValidHouseLoadW = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const constants_1 = require("./constants");
const time_1 = require("./time");
function hourStartMs(ts) {
    return Math.floor(ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
}
/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte. */
function isValidHouseLoadW(value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    return value >= constants_1.PLAUSIBLE_W_MIN && value <= constants_1.PLAUSIBLE_W_MAX;
}
exports.isValidHouseLoadW = isValidHouseLoadW;
/** Negative und Ausreißer oberhalb PLAUSIBLE_W_MAX verwerfen. */
function filterOutliers(values) {
    if (values.length < 5) {
        return values;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    return values.filter((v) => v >= low && v <= high);
}
exports.filterOutliers = filterOutliers;
async function fetchHouseLoadSamples(host, stateId, lookbackDays) {
    const samples = [];
    let lastValidTs = null;
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const byHour = new Map();
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const raw = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !isValidHouseLoadW(raw)) {
            continue;
        }
        if (raw < 0) {
            continue;
        }
        const bucket = hourStartMs(ts);
        const existing = byHour.get(bucket);
        if (existing === undefined || ts > (lastValidTs ?? 0)) {
            byHour.set(bucket, raw);
        }
        if (lastValidTs === null || ts > lastValidTs) {
            lastValidTs = ts;
        }
    }
    for (const [bucket, powerW] of byHour) {
        const d = new Date(bucket);
        const ctx = (0, time_1.calendarContext)(d);
        samples.push({
            ts: bucket,
            hourStartMs: bucket,
            dateKey: ctx.dateKey,
            hourOfDay: ctx.hourOfDay,
            segment: ctx.segment,
            season: ctx.season,
            weekday: ctx.weekday,
            dayType: ctx.dayType,
            powerW: Math.round(powerW),
        });
    }
    samples.sort((a, b) => a.hourStartMs - b.hourStartMs);
    return { samples, lastValidTs };
}
exports.fetchHouseLoadSamples = fetchHouseLoadSamples;
function distinctSampleDays(samples) {
    return new Set(samples.map((s) => s.dateKey)).size;
}
exports.distinctSampleDays = distinctSampleDays;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSampleDaysWithMinHours = exports.distinctSampleDays = exports.fetchHouseLoadSamples = exports.filterOutliers = exports.normalizeHouseLoadPowerW = exports.resolveHouseLoadPowerUnit = exports.detectPowerUnit = exports.isValidHouseLoadW = void 0;
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
function detectPowerUnit(stateId, unit) {
    const u = (unit ?? "").toLowerCase();
    if (u.includes("kw") || u.includes("kilowatt")) {
        return "kW";
    }
    if (u.includes("mw") || u.includes("megawatt")) {
        return "kW";
    }
    if (stateId.toLowerCase().includes("_kw") || stateId.toLowerCase().includes(".kw")) {
        return "kW";
    }
    return "W";
}
exports.detectPowerUnit = detectPowerUnit;
async function resolveHouseLoadPowerUnit(host, stateId) {
    if (!host.getObjectAsync) {
        return detectPowerUnit(stateId);
    }
    try {
        const obj = await host.getObjectAsync(stateId);
        const unit = obj?.common && typeof obj.common === "object"
            ? String(obj.common.unit ?? "")
            : "";
        return detectPowerUnit(stateId, unit);
    }
    catch {
        return detectPowerUnit(stateId);
    }
}
exports.resolveHouseLoadPowerUnit = resolveHouseLoadPowerUnit;
/** W/kW → W; fehlende Einheit: Werte < 100 eher kW (z. B. 3.5 statt 3500). */
function normalizeHouseLoadPowerW(raw, unit) {
    if (!Number.isFinite(raw)) {
        return null;
    }
    let watts = raw;
    if (unit === "kW") {
        watts = raw * 1000;
    }
    else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
        // Sonnen/Alias oft kW numerisch ohne korrekte common.unit
        watts = raw * 1000;
    }
    if (!isValidHouseLoadW(watts)) {
        return null;
    }
    return watts;
}
exports.normalizeHouseLoadPowerW = normalizeHouseLoadPowerW;
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
    const stats = {
        rowsTotal: 0,
        validRows: 0,
        hourlySamples: 0,
        skippedInvalid: 0,
        skippedNegative: 0,
        tsSpanHours: null,
    };
    const powerUnit = await resolveHouseLoadPowerUnit(host, stateId);
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    stats.rowsTotal = rows.length;
    /** Pro Stunde letzter gültiger Wert — wie battery_runtime/history.ts */
    const byHour = new Map();
    let tsMin = null;
    let tsMax = null;
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const raw = (0, state_util_1.asNum)(row?.val);
        if (ts === null || raw === null) {
            stats.skippedInvalid++;
            continue;
        }
        if (raw < 0) {
            stats.skippedNegative++;
            continue;
        }
        const powerW = normalizeHouseLoadPowerW(raw, powerUnit);
        if (powerW === null) {
            stats.skippedInvalid++;
            continue;
        }
        stats.validRows++;
        if (tsMin === null || ts < tsMin)
            tsMin = ts;
        if (tsMax === null || ts > tsMax)
            tsMax = ts;
        const bucket = hourStartMs(ts);
        const existing = byHour.get(bucket);
        if (!existing || ts > existing.ts) {
            byHour.set(bucket, { ts, powerW });
        }
        if (lastValidTs === null || ts > lastValidTs) {
            lastValidTs = ts;
        }
    }
    for (const { ts, powerW } of byHour.values()) {
        const d = new Date(ts);
        const ctx = (0, time_1.calendarContext)(d);
        samples.push({
            ts,
            hourStartMs: hourStartMs(ts),
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
    stats.hourlySamples = samples.length;
    if (tsMin !== null && tsMax !== null && tsMax > tsMin) {
        stats.tsSpanHours = Math.round((tsMax - tsMin) / constants_1.MS_PER_HOUR);
    }
    return { samples, lastValidTs, stats };
}
exports.fetchHouseLoadSamples = fetchHouseLoadSamples;
function distinctSampleDays(samples) {
    return new Set(samples.map((s) => s.dateKey)).size;
}
exports.distinctSampleDays = distinctSampleDays;
/** Tage mit mindestens MIN_DAY_HOURS Stunden-Samples (wie Price validHours). */
function distinctSampleDaysWithMinHours(samples, minHoursPerDay) {
    const byDay = new Map();
    for (const s of samples) {
        byDay.set(s.dateKey, (byDay.get(s.dateKey) ?? 0) + 1);
    }
    let days = 0;
    for (const count of byDay.values()) {
        if (count >= minHoursPerDay) {
            days++;
        }
    }
    return days;
}
exports.distinctSampleDaysWithMinHours = distinctSampleDaysWithMinHours;

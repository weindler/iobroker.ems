"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSocSampleDays = exports.readSecondsSinceFullCharge = exports.readLiveSoc = exports.readLiveCapacityKwh = exports.fetchPowerHistory = exports.fetchSocHistoryRaw = exports.fetchSocHistory = exports.normalizeBatteryPowerW = exports.isValidCapacityKwh = exports.isValidSoc = exports.mergeDailyAstroTimes = exports.buildDailyAstroTimes = exports.fetchAstroTimeHistory = exports.parseAstroTimeValue = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const constants_1 = require("./constants");
const time_1 = require("./time");
function parseAstroTimeValue(raw) {
    if (raw === null || raw === undefined)
        return null;
    const text = String(raw).trim();
    const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return null;
    return { hour, minute };
}
exports.parseAstroTimeValue = parseAstroTimeValue;
async function fetchAstroTimeHistory(host, stateId, lookbackDays) {
    const points = [];
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const parsed = parseAstroTimeValue(row?.val);
        if (ts === null || !parsed)
            continue;
        points.push({
            ts,
            dateKey: (0, time_1.localDateKey)(new Date(ts)),
            hour: parsed.hour,
            minute: parsed.minute,
        });
    }
    points.sort((a, b) => a.ts - b.ts);
    return points;
}
exports.fetchAstroTimeHistory = fetchAstroTimeHistory;
/** Pro Kalendertag die zuletzt geschriebene Astro-Zeit (tägliches JS-Update). */
function buildDailyAstroTimes(points) {
    const startByDate = new Map();
    const endByDate = new Map();
    for (const p of points) {
        startByDate.set(p.dateKey, { hour: p.hour, minute: p.minute });
    }
    return { startByDate, endByDate };
}
exports.buildDailyAstroTimes = buildDailyAstroTimes;
function mergeDailyAstroTimes(startPoints, endPoints) {
    const start = buildDailyAstroTimes(startPoints);
    const end = buildDailyAstroTimes(endPoints);
    return { startByDate: start.startByDate, endByDate: end.endByDate };
}
exports.mergeDailyAstroTimes = mergeDailyAstroTimes;
function hourBucket(ts) {
    return Math.floor(ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
}
function isValidSoc(value) {
    if (value === null || !Number.isFinite(value))
        return false;
    return value >= constants_1.SOC_MIN && value <= constants_1.SOC_MAX;
}
exports.isValidSoc = isValidSoc;
function isValidCapacityKwh(value) {
    if (value === null || !Number.isFinite(value))
        return false;
    return value > 0 && value <= 500;
}
exports.isValidCapacityKwh = isValidCapacityKwh;
/**
 * Nach Normalisierung: positiv = laden, negativ = entladen.
 * @param invert Quell-Vorzeichen umdrehen (z. B. Sonnen pacTotal: + entladen, − laden).
 */
function normalizeBatteryPowerW(raw, invert = false) {
    if (raw === null || !Number.isFinite(raw))
        return null;
    const signed = invert ? -raw : raw;
    if (Math.abs(signed) > constants_1.PLAUSIBLE_POWER_W_MAX)
        return null;
    if (Math.abs(signed) < constants_1.POWER_DEADBAND_W)
        return null;
    return Math.round(signed);
}
exports.normalizeBatteryPowerW = normalizeBatteryPowerW;
async function fetchHistoryPoints(host, stateId, lookbackDays, parseVal) {
    const byHour = new Map();
    let lastValidTs = null;
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const value = parseVal(row?.val);
        if (ts === null || value === null)
            continue;
        const bucket = hourBucket(ts);
        const existing = byHour.get(bucket);
        if (!existing || ts > existing.ts) {
            byHour.set(bucket, { ts, value });
        }
        if (lastValidTs === null || ts > lastValidTs) {
            lastValidTs = ts;
        }
    }
    const points = [...byHour.values()].sort((a, b) => a.ts - b.ts);
    return { points, lastValidTs };
}
async function fetchSocHistory(host, stateId, lookbackDays) {
    const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
        const n = (0, state_util_1.asNum)(raw);
        return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
    });
    return {
        points: points.map((p) => ({ ts: p.ts, socPct: p.value })),
        lastValidTs,
    };
}
exports.fetchSocHistory = fetchSocHistory;
/** Alle gültigen SOC-Punkte ohne Stunden-Dedup — für Vollladungs-Erkennung (Peaks zwischen Stunden). */
async function fetchSocHistoryRaw(host, stateId, lookbackDays) {
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const points = [];
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !isValidSoc(n))
            continue;
        points.push({ ts, socPct: Math.round(n * 100) / 100 });
    }
    points.sort((a, b) => a.ts - b.ts);
    return points;
}
exports.fetchSocHistoryRaw = fetchSocHistoryRaw;
async function fetchPowerHistory(host, stateId, lookbackDays, powerInvert = false) {
    const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
        const n = (0, state_util_1.asNum)(raw);
        return normalizeBatteryPowerW(n, powerInvert);
    });
    return {
        points: points.map((p) => ({ ts: p.ts, powerW: p.value })),
        lastValidTs,
    };
}
exports.fetchPowerHistory = fetchPowerHistory;
async function readLiveCapacityKwh(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        return isValidCapacityKwh(n) ? Math.round(n * 1000) / 1000 : null;
    }
    catch {
        return null;
    }
}
exports.readLiveCapacityKwh = readLiveCapacityKwh;
async function readLiveSoc(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
    }
    catch {
        return null;
    }
}
exports.readLiveSoc = readLiveSoc;
/** Geräte-State: Sekunden seit letzter Vollladung (Sonnen: latestData.secondsSinceFullCharge). */
async function readSecondsSinceFullCharge(host, stateId) {
    if (!stateId) {
        return null;
    }
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        if (n === null || !Number.isFinite(n) || n < 0) {
            return null;
        }
        return Math.round(n);
    }
    catch {
        return null;
    }
}
exports.readSecondsSinceFullCharge = readSecondsSinceFullCharge;
function distinctSocSampleDays(points) {
    return new Set(points.map((p) => new Date(p.ts).toISOString().slice(0, 10))).size;
}
exports.distinctSocSampleDays = distinctSocSampleDays;

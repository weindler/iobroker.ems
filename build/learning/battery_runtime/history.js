"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSocSampleDays = exports.readLiveSoc = exports.readLiveCapacityKwh = exports.fetchPowerHistory = exports.fetchSocHistory = exports.normalizeBatteryPowerW = exports.isValidCapacityKwh = exports.isValidSoc = void 0;
const state_util_1 = require("../../ems_light/state_util");
const constants_1 = require("./constants");
async function withHistoryTimeout(promise, timeoutMs) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            }),
        ]);
    }
    catch {
        return null;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
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
    const end = Date.now();
    const start = end - lookbackDays * constants_1.MS_PER_DAY;
    const byHour = new Map();
    let lastValidTs = null;
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        start,
        end,
        aggregate: "onchange",
        ignoreNull: true,
        count: 40_000,
        returnNewestEntries: true,
        removeBorderValues: true,
    }), constants_1.HISTORY_QUERY_TIMEOUT_MS);
    if (!res?.result || !Array.isArray(res.result)) {
        return { points: [], lastValidTs };
    }
    for (const row of res.result) {
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
function distinctSocSampleDays(points) {
    return new Set(points.map((p) => new Date(p.ts).toISOString().slice(0, 10))).size;
}
exports.distinctSocSampleDays = distinctSocSampleDays;

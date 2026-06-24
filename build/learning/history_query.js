"use strict";
/**
 * History-Abfragen in Tagesfenstern (wie PV-Bias).
 * Große 90-Tage-Bulk-Queries liefern in der Praxis oft leer — Tages-Chunks zuverlässiger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistoryRowsLookback = exports.fetchHistoryRowsInRange = exports.withHistoryTimeout = exports.dayBoundsMs = exports.HISTORY_ROWS_PER_DAY = exports.HISTORY_CHUNK_TIMEOUT_MS = void 0;
exports.HISTORY_CHUNK_TIMEOUT_MS = 10_000;
exports.HISTORY_ROWS_PER_DAY = 5_000;
const MS_PER_DAY = 86_400_000;
/** Lokale Mitternachtsgrenzen (dayOffset 0 = heute). */
function dayBoundsMs(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const start = d.getTime();
    return { start, end: start + MS_PER_DAY };
}
exports.dayBoundsMs = dayBoundsMs;
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
exports.withHistoryTimeout = withHistoryTimeout;
async function fetchHistoryRowsInRange(host, stateId, startMs, endMs, count = exports.HISTORY_ROWS_PER_DAY, timeoutMs = exports.HISTORY_CHUNK_TIMEOUT_MS) {
    if (!stateId) {
        return [];
    }
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        start: startMs,
        end: endMs,
        aggregate: "onchange",
        ignoreNull: true,
        count,
        returnNewestEntries: true,
        removeBorderValues: true,
    }), timeoutMs);
    if (!res?.result || !Array.isArray(res.result)) {
        return [];
    }
    return res.result;
}
exports.fetchHistoryRowsInRange = fetchHistoryRowsInRange;
/** Lookback in Tages-Chunks parallel (bewährt bei PV-Bias). */
async function fetchHistoryRowsLookback(host, stateId, lookbackDays, countPerDay = exports.HISTORY_ROWS_PER_DAY, timeoutMs = exports.HISTORY_CHUNK_TIMEOUT_MS) {
    if (!stateId || lookbackDays <= 0) {
        return [];
    }
    const chunks = await Promise.all(Array.from({ length: lookbackDays }, (_, dayOffset) => {
        const { start, end } = dayBoundsMs(dayOffset);
        return fetchHistoryRowsInRange(host, stateId, start, end, countPerDay, timeoutMs);
    }));
    const merged = chunks.flat();
    merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
    return merged;
}
exports.fetchHistoryRowsLookback = fetchHistoryRowsLookback;

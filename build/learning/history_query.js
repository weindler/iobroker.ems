"use strict";
/**
 * History-Abfragen für Learning-Module.
 * sendTo('history.0','getHistory') via Callback-Bridge (wie javascript.0).
 * getHistoryAsync nur wenn kein sendToAsync am Host.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistoryRowsLookback = exports.fetchHistoryRowsInRange = exports.withHistoryTimeout = exports.historyStateCandidates = exports.dayBoundsMs = exports.HISTORY_QUERY_OPTIONS = exports.HISTORY_AGGREGATES = exports.PER_DAY_FALLBACK_MAX_DAYS = exports.HISTORY_DAY_CONCURRENCY = exports.HISTORY_BULK_TIMEOUT_MS = exports.HISTORY_CHUNK_TIMEOUT_MS = exports.HISTORY_ROWS_PER_DAY = void 0;
exports.HISTORY_ROWS_PER_DAY = 500;
exports.HISTORY_CHUNK_TIMEOUT_MS = 45_000;
exports.HISTORY_BULK_TIMEOUT_MS = 45_000;
exports.HISTORY_DAY_CONCURRENCY = 4;
/** Nach leerem Bulk: max. so viele Tage einzeln — 90d×2 Aggregate würde den Tick blockieren. */
exports.PER_DAY_FALLBACK_MAX_DAYS = 7;
exports.HISTORY_AGGREGATES = ["none", "onchange"];
exports.HISTORY_QUERY_OPTIONS = {
    ignoreNull: true,
    returnNewestEntries: false,
    removeBorderValues: false,
};
const MS_PER_DAY = 86_400_000;
function dayBoundsMs(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const start = d.getTime();
    return { start, end: start + MS_PER_DAY };
}
exports.dayBoundsMs = dayBoundsMs;
function uniqueIds(ids) {
    const seen = new Set();
    const out = [];
    for (const id of ids) {
        const trimmed = id.trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}
async function historyStateCandidates(host, stateId) {
    if (!stateId) {
        return [];
    }
    if (!host.getObjectAsync || !stateId.startsWith("alias.")) {
        return [stateId];
    }
    try {
        const obj = await host.getObjectAsync(stateId);
        const common = obj?.common;
        const nativeId = common?.alias?.id?.trim();
        if (!nativeId || nativeId === stateId) {
            return [stateId];
        }
        if (common?.history?.enabled) {
            return uniqueIds([stateId, nativeId]);
        }
        return uniqueIds([nativeId, stateId]);
    }
    catch {
        return [stateId];
    }
}
exports.historyStateCandidates = historyStateCandidates;
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
async function mapInBatches(items, batchSize, fn) {
    const out = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const slice = items.slice(i, i + batchSize);
        const part = await Promise.all(slice.map((item, j) => fn(item, i + j)));
        out.push(...part);
    }
    return out;
}
function unwrapHistoryPayload(res) {
    if (!res || typeof res !== "object") {
        return {};
    }
    const obj = res;
    if ("result" in obj || "error" in obj) {
        return obj;
    }
    // adapter.sendToAsync liefert ioBroker.Message — Payload liegt in .message
    if (obj.message && typeof obj.message === "object") {
        const msg = obj.message;
        if ("result" in msg || "error" in msg) {
            return msg;
        }
    }
    return {};
}
function rowsFromHistoryMessage(res) {
    const payload = unwrapHistoryPayload(res);
    if (payload.error) {
        return [];
    }
    return Array.isArray(payload.result) ? payload.result : [];
}
function parseHistoryResponse(res) {
    if (res === null) {
        return { rows: [], timedOut: true, error: false };
    }
    const rows = rowsFromHistoryMessage(res);
    const err = unwrapHistoryPayload(res).error;
    if (err && rows.length === 0) {
        return { rows: [], timedOut: false, error: true };
    }
    return { rows, timedOut: false, error: false };
}
/** sendTo history.0 (Callback-Bridge); kein getHistoryAsync-Fallback bei leerem sendTo. */
async function invokeGetHistory(host, stateId, options, timeoutMs) {
    const message = { id: stateId, options };
    if (host.sendToAsync) {
        const viaSendTo = await withHistoryTimeout(host.sendToAsync("history.0", "getHistory", message), timeoutMs);
        return parseHistoryResponse(viaSendTo);
    }
    const viaAsync = await withHistoryTimeout(host.getHistoryAsync(stateId, options), timeoutMs);
    return parseHistoryResponse(viaAsync);
}
function mergeStats(a, b) {
    return {
        timedOut: a.timedOut + b.timedOut,
        empty: a.empty + b.empty,
        errors: a.errors + b.errors,
    };
}
function emptyStats() {
    return { timedOut: 0, empty: 0, errors: 0 };
}
async function fetchHistoryRowsInRange(host, stateId, startMs, endMs, count = exports.HISTORY_ROWS_PER_DAY, timeoutMs = exports.HISTORY_CHUNK_TIMEOUT_MS, aggregate = "onchange") {
    const result = await fetchHistoryRowsInRangeDetailed(host, stateId, startMs, endMs, count, timeoutMs, aggregate);
    return result.rows;
}
exports.fetchHistoryRowsInRange = fetchHistoryRowsInRange;
async function fetchHistoryRowsInRangeDetailed(host, stateId, startMs, endMs, count, timeoutMs, aggregate) {
    if (!stateId) {
        return { rows: [], stats: emptyStats() };
    }
    const { rows, timedOut, error } = await invokeGetHistory(host, stateId, {
        ...exports.HISTORY_QUERY_OPTIONS,
        aggregate,
        start: startMs,
        end: endMs,
        count,
    }, timeoutMs);
    const stats = emptyStats();
    if (timedOut)
        stats.timedOut = 1;
    else if (error)
        stats.errors = 1;
    else if (rows.length === 0)
        stats.empty = 1;
    return { rows, stats };
}
async function fetchHistoryWithAggregates(host, stateId, startMs, endMs, count, timeoutMs) {
    let stats = emptyStats();
    for (const aggregate of exports.HISTORY_AGGREGATES) {
        const attempt = await fetchHistoryRowsInRangeDetailed(host, stateId, startMs, endMs, count, timeoutMs, aggregate);
        stats = mergeStats(stats, attempt.stats);
        if (attempt.rows.length > 0) {
            return { rows: attempt.rows, stats };
        }
    }
    return { rows: [], stats };
}
function bulkWindowDays(lookbackDays) {
    const windows = [];
    for (const days of [7, 30, lookbackDays]) {
        if (days > 0 && days <= lookbackDays && !windows.includes(days)) {
            windows.push(days);
        }
    }
    return windows.sort((a, b) => a - b);
}
async function fetchHistoryBulkForId(host, stateId, lookbackDays) {
    let combinedStats = emptyStats();
    for (const days of bulkWindowDays(lookbackDays)) {
        if (host.log?.info) {
            host.log.info(`History query: bulk ${days}d für ${stateId}…`);
        }
        const endMs = Date.now();
        const startMs = endMs - days * MS_PER_DAY;
        const count = Math.min(Math.max(days * 120, 500), 20_000);
        const attempt = await fetchHistoryWithAggregates(host, stateId, startMs, endMs, count, exports.HISTORY_BULK_TIMEOUT_MS);
        combinedStats = mergeStats(combinedStats, attempt.stats);
        if (attempt.rows.length > 0) {
            return attempt;
        }
        if (host.log?.warn) {
            host.log.warn(`History query: bulk ${days}d ohne Treffer (${formatHistoryStats(attempt.stats)}) für ${stateId}`);
        }
    }
    return { rows: [], stats: combinedStats };
}
async function fetchHistoryPerDayForId(host, stateId, lookbackDays, countPerDay, timeoutMs) {
    const dayOffsets = Array.from({ length: lookbackDays }, (_, dayOffset) => dayOffset);
    let stats = emptyStats();
    const chunks = await mapInBatches(dayOffsets, exports.HISTORY_DAY_CONCURRENCY, async (dayOffset) => {
        const { start, end } = dayBoundsMs(dayOffset);
        const attempt = await fetchHistoryWithAggregates(host, stateId, start, end, countPerDay, timeoutMs);
        stats = mergeStats(stats, attempt.stats);
        return attempt.rows;
    });
    const merged = chunks.flat();
    merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
    return { rows: merged, stats };
}
async function fetchHistoryRowsLookbackForId(host, stateId, lookbackDays, countPerDay, timeoutMs) {
    const bulk = await fetchHistoryBulkForId(host, stateId, lookbackDays);
    if (bulk.rows.length > 0) {
        return bulk;
    }
    const fallbackDays = Math.min(lookbackDays, exports.PER_DAY_FALLBACK_MAX_DAYS);
    if (host.log?.info) {
        host.log.info(`History query: Tages-Fallback ${fallbackDays}d für ${stateId} (${formatHistoryStats(bulk.stats)})`);
    }
    const perDay = await fetchHistoryPerDayForId(host, stateId, fallbackDays, countPerDay, timeoutMs);
    return {
        rows: perDay.rows,
        stats: mergeStats(bulk.stats, perDay.stats),
    };
}
function formatHistoryStats(stats) {
    const parts = [];
    if (stats.timedOut > 0)
        parts.push(`${stats.timedOut}× timeout`);
    if (stats.empty > 0)
        parts.push(`${stats.empty}× leer`);
    if (stats.errors > 0)
        parts.push(`${stats.errors}× Fehler`);
    return parts.length > 0 ? parts.join(", ") : "keine Antwort";
}
async function fetchHistoryRowsLookback(host, stateId, lookbackDays, countPerDay = exports.HISTORY_ROWS_PER_DAY, timeoutMs = exports.HISTORY_CHUNK_TIMEOUT_MS) {
    if (!stateId || lookbackDays <= 0) {
        return [];
    }
    const candidates = await historyStateCandidates(host, stateId);
    let combinedStats = emptyStats();
    for (let i = 0; i < candidates.length; i++) {
        const candidateId = candidates[i];
        const attempt = await fetchHistoryRowsLookbackForId(host, candidateId, lookbackDays, countPerDay, timeoutMs);
        combinedStats = mergeStats(combinedStats, attempt.stats);
        if (attempt.rows.length > 0) {
            if (i > 0 && host.log?.warn) {
                host.log.warn(`History query: Daten über Fallback-State ${candidateId} (${attempt.rows.length} Zeilen, konfiguriert: ${stateId})`);
            }
            else if (host.log?.info) {
                host.log.info(`History query: ${attempt.rows.length} Zeilen für ${candidateId} (${lookbackDays}d)`);
            }
            return attempt.rows;
        }
    }
    if (host.log?.warn) {
        const tried = candidates.join(" → ");
        host.log.warn(`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}, ${formatHistoryStats(combinedStats)})`);
    }
    return [];
}
exports.fetchHistoryRowsLookback = fetchHistoryRowsLookback;

"use strict";
/**
 * History-Abfragen für Learning-Module.
 * Bulk-Fenster zuerst (1× history.0), Tages-Chunks als Fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistoryRowsLookback = exports.fetchHistoryRowsInRange = exports.withHistoryTimeout = exports.historyStateCandidates = exports.dayBoundsMs = exports.HISTORY_QUERY_OPTIONS = exports.HISTORY_AGGREGATES = exports.HISTORY_DAY_CONCURRENCY = exports.HISTORY_BULK_TIMEOUT_MS = exports.HISTORY_CHUNK_TIMEOUT_MS = exports.HISTORY_ROWS_PER_DAY = void 0;
exports.HISTORY_ROWS_PER_DAY = 500;
/** history.0 antwortet auf belasteten Hosts oft erst nach >10 s — kurzer Timeout → leere Arrays. */
exports.HISTORY_CHUNK_TIMEOUT_MS = 45_000;
exports.HISTORY_BULK_TIMEOUT_MS = 60_000;
exports.HISTORY_DAY_CONCURRENCY = 4;
exports.HISTORY_AGGREGATES = ["onchange", "none"];
/** history.0: returnNewestEntries + count kann Tagesfenster leeren (ioBroker/history#238). */
exports.HISTORY_QUERY_OPTIONS = {
    ignoreNull: true,
    returnNewestEntries: false,
    removeBorderValues: false,
};
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
function rowsFromHistoryMessage(res) {
    if (!res || typeof res !== "object") {
        return [];
    }
    const payload = res;
    if (payload.error) {
        return [];
    }
    return Array.isArray(payload.result) ? payload.result : [];
}
async function invokeGetHistory(host, stateId, options, timeoutMs) {
    const res = await withHistoryTimeout((async () => {
        if (host.sendToAsync) {
            try {
                return await host.sendToAsync("history.0", "getHistory", { id: stateId, options });
            }
            catch {
                // getHistoryAsync versucht defaultHistory-Instanz
            }
        }
        return host.getHistoryAsync(stateId, options);
    })(), timeoutMs);
    if (res === null) {
        return { rows: [], timedOut: true, error: false };
    }
    const rows = rowsFromHistoryMessage(res);
    if (!Array.isArray(res.result) && rows.length === 0) {
        const err = res.error;
        if (err) {
            return { rows: [], timedOut: false, error: true };
        }
    }
    return { rows, timedOut: false, error: false };
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
/** Ein Fenster für den gesamten Lookback — weniger Roundtrips, höheres Timeout. */
async function fetchHistoryBulkForId(host, stateId, lookbackDays) {
    const endMs = Date.now();
    const startMs = endMs - lookbackDays * MS_PER_DAY;
    const count = Math.min(Math.max(lookbackDays * 120, 500), 20_000);
    return fetchHistoryWithAggregates(host, stateId, startMs, endMs, count, exports.HISTORY_BULK_TIMEOUT_MS);
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
    const perDay = await fetchHistoryPerDayForId(host, stateId, lookbackDays, countPerDay, timeoutMs);
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
/** Lookback: Bulk zuerst, dann Tages-Chunks; Alias→Quell-Fallback. */
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
            if (host.log?.debug) {
                host.log.debug(`History query: ${attempt.rows.length} rows for ${candidateId} (${lookbackDays}d)`);
            }
            return attempt.rows;
        }
    }
    if (host.log?.warn) {
        const tried = candidates.join(" → ");
        host.log.warn(`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}, ${formatHistoryStats(combinedStats)}) — history.0/langsame Antwort?`);
    }
    return [];
}
exports.fetchHistoryRowsLookback = fetchHistoryRowsLookback;

"use strict";
/**
 * History-Abfragen in Tagesfenstern (wie PV-Bias).
 * Große 90-Tage-Bulk-Queries liefern in der Praxis oft leer — Tages-Chunks zuverlässiger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHistoryRowsLookback = exports.fetchHistoryRowsInRange = exports.withHistoryTimeout = exports.historyStateCandidates = exports.dayBoundsMs = exports.HISTORY_DAY_CONCURRENCY = exports.HISTORY_CHUNK_TIMEOUT_MS = exports.HISTORY_ROWS_PER_DAY = void 0;
/** Wie PV-Bias fetchDayLastValue — ausreichend für onchange-Tagesfenster. */
exports.HISTORY_ROWS_PER_DAY = 500;
exports.HISTORY_CHUNK_TIMEOUT_MS = 10_000;
/** Zu viele parallele getHistoryAsync-Calls überlasten history.0 (90× parallel → oft leer). */
exports.HISTORY_DAY_CONCURRENCY = 8;
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
/**
 * Alias ohne eigene Historie → Quell-State (z. B. sonnen.0.status.userSoc).
 * Alias mit Historie → zuerst Alias, dann Quell-State als Fallback.
 */
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
async function fetchHistoryRowsLookbackForId(host, stateId, lookbackDays, countPerDay, timeoutMs) {
    const dayOffsets = Array.from({ length: lookbackDays }, (_, dayOffset) => dayOffset);
    const chunks = await mapInBatches(dayOffsets, exports.HISTORY_DAY_CONCURRENCY, async (dayOffset) => {
        const { start, end } = dayBoundsMs(dayOffset);
        return fetchHistoryRowsInRange(host, stateId, start, end, countPerDay, timeoutMs);
    });
    const merged = chunks.flat();
    merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
    return merged;
}
/** Lookback in Tages-Chunks mit begrenzter Parallelität; Alias→Quell-Fallback. */
async function fetchHistoryRowsLookback(host, stateId, lookbackDays, countPerDay = exports.HISTORY_ROWS_PER_DAY, timeoutMs = exports.HISTORY_CHUNK_TIMEOUT_MS) {
    if (!stateId || lookbackDays <= 0) {
        return [];
    }
    const candidates = await historyStateCandidates(host, stateId);
    for (let i = 0; i < candidates.length; i++) {
        const candidateId = candidates[i];
        const rows = await fetchHistoryRowsLookbackForId(host, candidateId, lookbackDays, countPerDay, timeoutMs);
        if (rows.length > 0) {
            if (i > 0 && host.log?.warn) {
                host.log.warn(`History query: Daten über Fallback-State ${candidateId} (${rows.length} Zeilen, konfiguriert: ${stateId})`);
            }
            return rows;
        }
    }
    if (host.log?.warn) {
        const tried = candidates.join(" → ");
        host.log.warn(`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}) — history.0 am State prüfen`);
    }
    return [];
}
exports.fetchHistoryRowsLookback = fetchHistoryRowsLookback;

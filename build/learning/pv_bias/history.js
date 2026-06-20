"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvBiasDayPairs = exports.fetchDayLastValue = exports.dayBoundsMs = exports.HISTORY_QUERY_TIMEOUT_MS = void 0;
const state_util_1 = require("../../ems_light/state_util");
exports.HISTORY_QUERY_TIMEOUT_MS = 8000;
const MS_PER_DAY = 86_400_000;
/** Lokale Mitternachtsgrenzen für einen Tag (dayOffset 0 = heute). */
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
        if (timer) {
            clearTimeout(timer);
        }
    }
}
async function readLiveValue(host, stateId) {
    if (!stateId) {
        return null;
    }
    const read = host.getForeignStateAsync ?? host.getStateAsync;
    if (!read) {
        return null;
    }
    try {
        const st = await read.call(host, stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
/** Letzter gültiger Zahlenwert im Tagesfenster; fehlende Historie → null (nicht 0). */
async function fetchDayLastValue(host, stateId, startMs, endMs) {
    if (!stateId) {
        return null;
    }
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        start: startMs,
        end: endMs,
        aggregate: "onchange",
        ignoreNull: true,
        count: 500,
        returnNewestEntries: true,
        removeBorderValues: true,
    }), exports.HISTORY_QUERY_TIMEOUT_MS);
    if (res === null) {
        return null;
    }
    try {
        const rows = res.result;
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            const n = (0, state_util_1.asNum)(row?.val);
            if (n !== null) {
                return n;
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
exports.fetchDayLastValue = fetchDayLastValue;
/** Sammelt gültige Tagespaare für die letzten 30 Tage (inkl. heute). Fehlende Tage werden übersprungen. */
async function fetchDayPair(host, dayOffset, actualStateId, forecastStateId) {
    const { start, end } = dayBoundsMs(dayOffset);
    let actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
    let forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);
    if (dayOffset === 0) {
        if (actualKwh === null) {
            actualKwh = await readLiveValue(host, actualStateId);
        }
        if (forecastKwh === null) {
            forecastKwh = await readLiveValue(host, forecastStateId);
        }
    }
    if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
        return null;
    }
    return { dayOffset, actualKwh, forecastKwh };
}
async function fetchPvBiasDayPairs(host, actualStateId, forecastStateId, maxDays = 30) {
    const results = await Promise.all(Array.from({ length: maxDays }, (_, dayOffset) => fetchDayPair(host, dayOffset, actualStateId, forecastStateId)));
    return results.filter((p) => p !== null);
}
exports.fetchPvBiasDayPairs = fetchPvBiasDayPairs;

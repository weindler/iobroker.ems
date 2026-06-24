"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvBiasDayPairs = exports.fetchDayLastValue = exports.readStateNum = exports.isForeignStateId = exports.dayBoundsMs = exports.HISTORY_QUERY_TIMEOUT_MS = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
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
    return readStateNum(host, stateId);
}
/** Vollqualifizierte ID z. B. alias.0.x — nicht relative ems-eigene IDs wie learning.pv_bias.* */
function isForeignStateId(stateId) {
    return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}
exports.isForeignStateId = isForeignStateId;
async function readStateNum(host, stateId) {
    if (!stateId) {
        return null;
    }
    const tryRead = async (fn) => {
        if (!fn) {
            return null;
        }
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
        if (foreign !== null) {
            return foreign;
        }
        return tryRead(host.getStateAsync);
    }
    const own = await tryRead(host.getStateAsync);
    if (own !== null) {
        return own;
    }
    return tryRead(host.getForeignStateAsync);
}
exports.readStateNum = readStateNum;
/** Letzter gültiger Zahlenwert im Tagesfenster; fehlende Historie → null (nicht 0). */
async function fetchDayLastValue(host, stateId, startMs, endMs) {
    if (!stateId) {
        return null;
    }
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        ...history_query_1.HISTORY_QUERY_OPTIONS,
        start: startMs,
        end: endMs,
        count: 500,
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

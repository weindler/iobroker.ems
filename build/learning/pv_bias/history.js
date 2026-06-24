"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvBiasDayPairs = exports.fetchDayLastValue = exports.readStateNum = exports.isForeignStateId = exports.dayBoundsMs = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
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
function localDateKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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
function lastValidValueFromRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
        const n = (0, state_util_1.asNum)(rows[i]?.val);
        if (n !== null) {
            return n;
        }
    }
    return null;
}
/** Letzter gültiger Zahlenwert im Tagesfenster; fehlende Historie → null (nicht 0). */
async function fetchDayLastValue(host, stateId, startMs, endMs) {
    if (!stateId) {
        return null;
    }
    const rows = await (0, history_query_1.fetchHistoryRowsInRange)(host, stateId, startMs, endMs, 500, history_query_1.HISTORY_CHUNK_TIMEOUT_MS, "none");
    return lastValidValueFromRows(rows);
}
exports.fetchDayLastValue = fetchDayLastValue;
/** Tagesmaximum via history.0 aggregate — robuster als onChange-Roh-timestamps. */
async function fetchDailyMaxMap(host, stateId, startMs, endMs, maxDays) {
    const map = new Map();
    if (!stateId) {
        return map;
    }
    const rows = await (0, history_query_1.fetchHistoryRowsAggregated)(host, stateId, startMs, endMs, maxDays + 5, history_query_1.HISTORY_CHUNK_TIMEOUT_MS, "max", MS_PER_DAY);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || n === null || n <= 0) {
            continue;
        }
        map.set(localDateKey(ts), n);
    }
    return map;
}
/** Sammelt gültige Tagespaare für die letzten 30 Tage (inkl. heute). Fehlende Tage werden übersprungen. */
async function fetchPvBiasDayPairs(host, actualStateId, forecastStateId, maxDays = 30) {
    const endMs = Date.now();
    const startMs = endMs - maxDays * MS_PER_DAY;
    const [actualByDay, forecastByDay] = await Promise.all([
        fetchDailyMaxMap(host, actualStateId, startMs, endMs, maxDays),
        fetchDailyMaxMap(host, forecastStateId, startMs, endMs, maxDays),
    ]);
    const pairs = [];
    for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
        const { start } = dayBoundsMs(dayOffset);
        const dateKey = localDateKey(start);
        let actualKwh = actualByDay.get(dateKey) ?? null;
        let forecastKwh = forecastByDay.get(dateKey) ?? null;
        if (dayOffset === 0) {
            if (actualKwh === null) {
                actualKwh = await readLiveValue(host, actualStateId);
            }
            if (forecastKwh === null) {
                forecastKwh = await readLiveValue(host, forecastStateId);
            }
        }
        if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
            continue;
        }
        pairs.push({ dayOffset, actualKwh, forecastKwh });
    }
    if (pairs.length >= Math.min(maxDays, 7)) {
        return pairs;
    }
    // Fallback: Tages-Fenster einzeln (z. B. wenn aggregate leer)
    const fallback = await Promise.all(Array.from({ length: maxDays }, (_, dayOffset) => fetchDayPairFallback(host, dayOffset, actualStateId, forecastStateId)));
    return fallback.filter((p) => p !== null);
}
exports.fetchPvBiasDayPairs = fetchPvBiasDayPairs;
async function fetchDayPairFallback(host, dayOffset, actualStateId, forecastStateId) {
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

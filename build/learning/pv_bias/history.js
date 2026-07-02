"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvBiasDayPairs = exports.fetchDayValueNearTime = exports.fetchDayLastValue = exports.readStateNum = exports.isForeignStateId = exports.dayBoundsMs = void 0;
const state_util_1 = require("../../ems_light/state_util");
const read_1 = require("../energy_daily_rollup/read");
const history_query_1 = require("../history_query");
const dates_1 = require("./dates");
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
function firstValidValueFromRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }
    for (const row of rows) {
        const n = (0, state_util_1.asNum)(row?.val);
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
/** Erster gültiger Wert in einem Zeitfenster (z. B. Forecast um Freeze-Zeit). */
async function fetchDayValueNearTime(host, stateId, startMs, endMs) {
    if (!stateId) {
        return null;
    }
    const rows = await (0, history_query_1.fetchHistoryRowsInRange)(host, stateId, startMs, endMs, 500, history_query_1.HISTORY_CHUNK_TIMEOUT_MS, "none");
    return firstValidValueFromRows(rows);
}
exports.fetchDayValueNearTime = fetchDayValueNearTime;
/**
 * Sammelt gültige Tagespaare (Ist vs. Forecast) der letzten 30 Tage.
 * Vergangene Tage: Snapshot-Datei oder letzter Tageswert (kein MAX — DAY_ENERGY resettet morgens).
 * Heute: Live-Ist + eingefrorener Forecast.
 */
async function fetchPvBiasDayPairs(host, actualStateId, forecastStateId, options = {}) {
    const maxDays = options.maxDays ?? 30;
    const todayForecastOverride = options.todayForecastOverride ?? null;
    const dailyPersist = options.dailyPersist ?? null;
    const pairs = [];
    let actualDays = 0;
    let forecastDays = 0;
    for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
        const { start, end } = dayBoundsMs(dayOffset);
        const dateKey = (0, dates_1.localDateKey)(new Date(start));
        const stored = dailyPersist?.days[dateKey] ?? null;
        let actualKwh = null;
        let forecastKwh = null;
        if (dayOffset === 0) {
            actualKwh = await readLiveValue(host, actualStateId);
            if (todayForecastOverride !== null && todayForecastOverride > 0) {
                forecastKwh = todayForecastOverride;
            }
            else {
                forecastKwh = await readLiveValue(host, forecastStateId);
            }
        }
        else {
            actualKwh = stored?.actualKwh ?? null;
            forecastKwh = stored?.forecastKwh ?? null;
            if (actualKwh === null) {
                actualKwh = await (0, read_1.fetchRollupDayKwh)(host, actualStateId, dateKey);
            }
            if (actualKwh === null) {
                actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
            }
            if (forecastKwh === null) {
                forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);
            }
        }
        if (actualKwh !== null) {
            actualDays++;
        }
        if (forecastKwh !== null && forecastKwh > 0) {
            forecastDays++;
        }
        if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
            continue;
        }
        pairs.push({ dayOffset, actualKwh, forecastKwh });
    }
    return { pairs, actualDays, forecastDays, forecastSourceUsed: forecastStateId };
}
exports.fetchPvBiasDayPairs = fetchPvBiasDayPairs;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPvBiasDayPairs = exports.fetchDayLastValue = exports.dayBoundsMs = void 0;
const state_util_1 = require("../../ems_light/state_util");
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
/** Letzter gültiger Zahlenwert im Tagesfenster; fehlende Historie → null (nicht 0). */
async function fetchDayLastValue(host, stateId, startMs, endMs) {
    if (!stateId) {
        return null;
    }
    try {
        const res = await host.getHistoryAsync(stateId, {
            start: startMs,
            end: endMs,
            aggregate: "onchange",
            ignoreNull: true,
            count: 500,
            returnNewestEntries: true,
            removeBorderValues: true,
        });
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
async function fetchPvBiasDayPairs(host, actualStateId, forecastStateId, maxDays = 30) {
    const pairs = [];
    for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
        const { start, end } = dayBoundsMs(dayOffset);
        const actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
        const forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);
        if (actualKwh === null || forecastKwh === null) {
            continue;
        }
        if (forecastKwh <= 0) {
            continue;
        }
        pairs.push({ dayOffset, actualKwh, forecastKwh });
    }
    return pairs;
}
exports.fetchPvBiasDayPairs = fetchPvBiasDayPairs;

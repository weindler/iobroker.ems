"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchTemperatureHistory = exports.isValidTempC = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const constants_1 = require("./constants");
/** missing ≠ 0 — nur endliche, plausible °C-Werte. */
function isValidTempC(value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    return value >= constants_1.PLAUSIBLE_TEMP_MIN_C && value <= constants_1.PLAUSIBLE_TEMP_MAX_C;
}
exports.isValidTempC = isValidTempC;
async function fetchTemperatureHistory(host, stateId, lookbackDays) {
    const points = [];
    let lastValidTs = null;
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const tempC = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !isValidTempC(tempC)) {
            continue;
        }
        points.push({ ts, tempC: Math.round(tempC * 100) / 100 });
        if (lastValidTs === null || ts > lastValidTs) {
            lastValidTs = ts;
        }
    }
    points.sort((a, b) => a.ts - b.ts);
    return { points, lastValidTs };
}
exports.fetchTemperatureHistory = fetchTemperatureHistory;

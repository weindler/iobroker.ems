"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchTemperatureHistory = exports.isValidTempC = void 0;
const state_util_1 = require("../../ems_light/state_util");
const constants_1 = require("./constants");
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
/** missing ≠ 0 — nur endliche, plausible °C-Werte. */
function isValidTempC(value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    return value >= constants_1.PLAUSIBLE_TEMP_MIN_C && value <= constants_1.PLAUSIBLE_TEMP_MAX_C;
}
exports.isValidTempC = isValidTempC;
async function fetchTemperatureHistory(host, stateId, lookbackDays) {
    const end = Date.now();
    const start = end - lookbackDays * constants_1.MS_PER_DAY;
    const points = [];
    let lastValidTs = null;
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        start,
        end,
        aggregate: "onchange",
        ignoreNull: true,
        count: 50_000,
        returnNewestEntries: true,
        removeBorderValues: true,
    }), constants_1.HISTORY_QUERY_TIMEOUT_MS);
    if (!res?.result || !Array.isArray(res.result)) {
        return { points, lastValidTs };
    }
    for (const row of res.result) {
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDailyCall = exports.readAndRolloverDailyCalls = void 0;
const state_util_1 = require("../ems_light/state_util");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
function localDateKey(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/** Liest Tageszähler + Kostenschätzung und setzt beide bei Tageswechsel zurück (kein Timer nötig, prüft bei jedem Zugriff). */
async function readAndRolloverDailyCalls(host, maxCallsPerDay, now = new Date()) {
    const today = localDateKey(now);
    const storedDate = String((await host.getStateAsync(ensure_states_1.AI_STATES.callsTodayDate))?.val ?? "");
    let callsToday = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.callsToday))?.val) ?? 0;
    let costTodayEur = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur))?.val) ?? 0;
    if (storedDate !== today) {
        callsToday = 0;
        costTodayEur = 0;
        await host.setStateAsync(ensure_states_1.AI_STATES.callsTodayDate, { val: today, ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.callsToday, { val: 0, ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur, { val: 0, ack: true });
    }
    const limitReached = callsToday >= maxCallsPerDay;
    const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * config_1.AI_SOFT_WARNING_FRACTION);
    await host.setStateAsync(ensure_states_1.AI_STATES.callsLimit, { val: maxCallsPerDay, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.limitWarning, { val: softWarning, ack: true });
    return { callsToday, limit: maxCallsPerDay, limitReached, softWarning, costTodayEur };
}
exports.readAndRolloverDailyCalls = readAndRolloverDailyCalls;
/** Zählt einen tatsächlich durchgeführten KI-Call (Attempt, unabhängig vom Ergebnis) + addiert Kostenschätzung. */
async function recordDailyCall(host, maxCallsPerDay, addCostEur, now = new Date()) {
    const state = await readAndRolloverDailyCalls(host, maxCallsPerDay, now);
    const callsToday = state.callsToday + 1;
    const costTodayEur = Math.round((state.costTodayEur + addCostEur) * 100_000) / 100_000;
    await host.setStateAsync(ensure_states_1.AI_STATES.callsToday, { val: callsToday, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur, { val: costTodayEur, ack: true });
    const limitReached = callsToday >= maxCallsPerDay;
    const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * config_1.AI_SOFT_WARNING_FRACTION);
    await host.setStateAsync(ensure_states_1.AI_STATES.limitWarning, { val: softWarning, ack: true });
    return { callsToday, limit: maxCallsPerDay, limitReached, softWarning, costTodayEur };
}
exports.recordDailyCall = recordDailyCall;

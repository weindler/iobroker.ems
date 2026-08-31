"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDailyCall = exports.readAndRolloverDailyCalls = exports.localMonthKey = exports.localDateKey = void 0;
const state_util_1 = require("../ems_light/state_util");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
/** Kalendertag in Hauszeitzone (Default Europe/Berlin) — YYYY-MM-DD. */
function localDateKey(now, timeZone = "Europe/Berlin") {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(now);
    }
    catch {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
}
exports.localDateKey = localDateKey;
function localMonthKey(now, timeZone = "Europe/Berlin") {
    return localDateKey(now, timeZone).slice(0, 7);
}
exports.localMonthKey = localMonthKey;
/**
 * Tagesbezogene KI-Anzeige/Prefs nach Mitternacht leeren — damit VIS nicht gestrige
 * Denkspur/Begründung als „aktuell“ zeigt und Auto-Sperre den neuen Tag nicht blockiert.
 */
async function clearPreviousDayAiDisplay(host) {
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingDe, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastReasonDe, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastDecisionsJson, { val: "[]", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastRunResult, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastError, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingMode, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspended, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspendReasonDe, { val: "", ack: true });
}
async function rolloverMonth(host, now, timeZone) {
    const month = localMonthKey(now, timeZone);
    const stored = String((await host.getStateAsync(ensure_states_1.AI_STATES.costMonthKey))?.val ?? "");
    let costMonthEur = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.costEstimateMonthEur))?.val) ?? 0;
    if (stored !== month) {
        costMonthEur = 0;
        await host.setStateAsync(ensure_states_1.AI_STATES.costMonthKey, { val: month, ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateMonthEur, { val: 0, ack: true });
    }
    return { costMonthEur, monthKey: month };
}
/** Liest Tageszähler + Kostenschätzung und setzt bei Tages-/Monatswechsel zurück. */
async function readAndRolloverDailyCalls(host, maxCallsPerDay, now = new Date(), monthlyCostLimitEur = 0, timeZone = "Europe/Berlin") {
    const today = localDateKey(now, timeZone);
    const storedDate = String((await host.getStateAsync(ensure_states_1.AI_STATES.callsTodayDate))?.val ?? "");
    let callsToday = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.callsToday))?.val) ?? 0;
    let costTodayEur = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur))?.val) ?? 0;
    let rolledOver = false;
    if (storedDate !== today) {
        rolledOver = true;
        callsToday = 0;
        costTodayEur = 0;
        await host.setStateAsync(ensure_states_1.AI_STATES.callsTodayDate, { val: today, ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.callsToday, { val: 0, ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur, { val: 0, ack: true });
        await clearPreviousDayAiDisplay(host);
    }
    const { costMonthEur } = await rolloverMonth(host, now, timeZone);
    const monthlyLimitEur = monthlyCostLimitEur > 0 ? monthlyCostLimitEur : 0;
    const monthlyLimitReached = monthlyLimitEur > 0 && costMonthEur >= monthlyLimitEur;
    const limitReached = callsToday >= maxCallsPerDay || monthlyLimitReached;
    const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * config_1.AI_SOFT_WARNING_FRACTION);
    await host.setStateAsync(ensure_states_1.AI_STATES.callsLimit, { val: maxCallsPerDay, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.limitWarning, { val: softWarning, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.monthlyCostLimitEur, { val: monthlyLimitEur, ack: true });
    return {
        callsToday,
        limit: maxCallsPerDay,
        limitReached,
        softWarning,
        costTodayEur,
        costMonthEur,
        monthlyLimitEur,
        monthlyLimitReached,
        rolledOver,
    };
}
exports.readAndRolloverDailyCalls = readAndRolloverDailyCalls;
/** Zählt einen tatsächlich durchgeführten KI-Call + addiert Kostenschätzung (Tag + Monat). */
async function recordDailyCall(host, maxCallsPerDay, addCostEur, now = new Date(), monthlyCostLimitEur = 0, timeZone = "Europe/Berlin", category) {
    const state = await readAndRolloverDailyCalls(host, maxCallsPerDay, now, monthlyCostLimitEur, timeZone);
    const callsToday = state.callsToday + 1;
    const costTodayEur = Math.round((state.costTodayEur + addCostEur) * 100_000) / 100_000;
    const costMonthEur = Math.round((state.costMonthEur + addCostEur) * 100_000) / 100_000;
    await host.setStateAsync(ensure_states_1.AI_STATES.callsToday, { val: callsToday, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateTodayEur, { val: costTodayEur, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.costEstimateMonthEur, { val: costMonthEur, ack: true });
    if (category) {
        await host.setStateAsync(ensure_states_1.AI_STATES.lastCallCategory, { val: category, ack: true });
    }
    const monthlyLimitEur = monthlyCostLimitEur > 0 ? monthlyCostLimitEur : 0;
    const monthlyLimitReached = monthlyLimitEur > 0 && costMonthEur >= monthlyLimitEur;
    const limitReached = callsToday >= maxCallsPerDay || monthlyLimitReached;
    const softWarning = !limitReached && callsToday >= Math.floor(maxCallsPerDay * config_1.AI_SOFT_WARNING_FRACTION);
    await host.setStateAsync(ensure_states_1.AI_STATES.limitWarning, { val: softWarning, ack: true });
    return {
        callsToday,
        limit: maxCallsPerDay,
        limitReached,
        softWarning,
        costTodayEur,
        costMonthEur,
        monthlyLimitEur,
        monthlyLimitReached,
        rolledOver: state.rolledOver,
    };
}
exports.recordDailyCall = recordDailyCall;

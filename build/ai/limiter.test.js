"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const limiter_js_1 = require("./limiter.js");
const ensure_states_js_1 = require("./ensure_states.js");
function mockHost(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
    };
}
(0, node_test_1.describe)("ai limiter", () => {
    (0, node_test_1.it)("starts at 0/limit, not reached, no warning", async () => {
        const host = mockHost();
        const state = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 20, new Date("2026-07-25T10:00:00+02:00"));
        strict_1.default.equal(state.callsToday, 0);
        strict_1.default.equal(state.limit, 20);
        strict_1.default.equal(state.limitReached, false);
        strict_1.default.equal(state.softWarning, false);
    });
    (0, node_test_1.it)("recordDailyCall increments the counter and accumulates cost", async () => {
        const host = mockHost();
        const now = new Date("2026-07-25T10:00:00+02:00");
        const s1 = await (0, limiter_js_1.recordDailyCall)(host, 20, 0.01, now);
        strict_1.default.equal(s1.callsToday, 1);
        strict_1.default.equal(s1.costTodayEur, 0.01);
        const s2 = await (0, limiter_js_1.recordDailyCall)(host, 20, 0.02, now);
        strict_1.default.equal(s2.callsToday, 2);
        strict_1.default.equal(s2.costTodayEur, 0.03);
    });
    (0, node_test_1.it)("soft warning triggers at 80% of the limit", async () => {
        const host = mockHost();
        const now = new Date("2026-07-25T10:00:00+02:00");
        for (let i = 0; i < 3; i++)
            await (0, limiter_js_1.recordDailyCall)(host, 5, 0, now);
        let state = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 5, now);
        strict_1.default.equal(state.softWarning, false);
        await (0, limiter_js_1.recordDailyCall)(host, 5, 0, now);
        state = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 5, now);
        strict_1.default.equal(state.callsToday, 4);
        strict_1.default.equal(state.softWarning, true);
        strict_1.default.equal(state.limitReached, false);
    });
    (0, node_test_1.it)("limit reached blocks further calls (limitReached=true)", async () => {
        const host = mockHost();
        const now = new Date("2026-07-25T10:00:00+02:00");
        for (let i = 0; i < 5; i++)
            await (0, limiter_js_1.recordDailyCall)(host, 5, 0, now);
        const state = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 5, now);
        strict_1.default.equal(state.limitReached, true);
        strict_1.default.equal(state.softWarning, false);
    });
    (0, node_test_1.it)("resets counter and cost on a new local day", async () => {
        const host = mockHost();
        await (0, limiter_js_1.recordDailyCall)(host, 5, 1.23, new Date("2026-07-24T23:30:00+02:00"));
        const rolled = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 5, new Date("2026-07-25T00:30:00+02:00"));
        strict_1.default.equal(rolled.callsToday, 0);
        strict_1.default.equal(rolled.costTodayEur, 0);
        strict_1.default.equal(rolled.rolledOver, true);
    });
    (0, node_test_1.it)("clears previous-day AI display states on local midnight rollover", async () => {
        const host = mockHost({
            [ensure_states_js_1.AI_STATES.callsToday]: 3,
            [ensure_states_js_1.AI_STATES.callsTodayDate]: "2026-07-24",
            [ensure_states_js_1.AI_STATES.costEstimateTodayEur]: 0.05,
            [ensure_states_js_1.AI_STATES.lastThinkingDe]: "gestern gedacht",
            [ensure_states_js_1.AI_STATES.lastReasonDe]: "gestern begründet",
            [ensure_states_js_1.AI_STATES.lastDecisionsJson]: '[{"addonId":"battery"}]',
            [ensure_states_js_1.AI_STATES.lastSlotPreferencesJson]: '[{"addonId":"battery","weight":2}]',
            [ensure_states_js_1.AI_STATES.autoSuspended]: true,
            [ensure_states_js_1.AI_STATES.autoSuspendReasonDe]: "kein Vorteil",
        });
        const rolled = await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 20, new Date("2026-07-25T00:05:00+02:00"));
        strict_1.default.equal(rolled.rolledOver, true);
        strict_1.default.equal(rolled.callsToday, 0);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.lastThinkingDe))?.val, "");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.lastReasonDe))?.val, "");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.lastDecisionsJson))?.val, "[]");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.lastSlotPreferencesJson))?.val, "[]");
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.autoSuspended))?.val, false);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.autoSuspendReasonDe))?.val, "");
    });
    (0, node_test_1.it)("writes calls_limit and limit_warning states as a side effect", async () => {
        const host = mockHost();
        const now = new Date("2026-07-25T10:00:00+02:00");
        await (0, limiter_js_1.readAndRolloverDailyCalls)(host, 20, now);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.callsLimit))?.val, 20);
        strict_1.default.equal((await host.getStateAsync(ensure_states_js_1.AI_STATES.limitWarning))?.val, false);
    });
});

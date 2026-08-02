import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readAndRolloverDailyCalls, recordDailyCall } from "./limiter.js";
import { AI_STATES } from "./ensure_states.js";
import type { LimiterHost } from "./limiter.js";

function mockHost(initial: Record<string, ioBroker.StateValue> = {}): LimiterHost {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initial));
	return {
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("ai limiter", () => {
	it("starts at 0/limit, not reached, no warning", async () => {
		const host = mockHost();
		const state = await readAndRolloverDailyCalls(host, 20, new Date("2026-07-25T10:00:00+02:00"));
		assert.equal(state.callsToday, 0);
		assert.equal(state.limit, 20);
		assert.equal(state.limitReached, false);
		assert.equal(state.softWarning, false);
	});

	it("recordDailyCall increments the counter and accumulates cost", async () => {
		const host = mockHost();
		const now = new Date("2026-07-25T10:00:00+02:00");
		const s1 = await recordDailyCall(host, 20, 0.01, now);
		assert.equal(s1.callsToday, 1);
		assert.equal(s1.costTodayEur, 0.01);
		const s2 = await recordDailyCall(host, 20, 0.02, now);
		assert.equal(s2.callsToday, 2);
		assert.equal(s2.costTodayEur, 0.03);
	});

	it("soft warning triggers at 80% of the limit", async () => {
		const host = mockHost();
		const now = new Date("2026-07-25T10:00:00+02:00");
		for (let i = 0; i < 3; i++) await recordDailyCall(host, 5, 0, now);
		let state = await readAndRolloverDailyCalls(host, 5, now);
		assert.equal(state.softWarning, false);
		await recordDailyCall(host, 5, 0, now);
		state = await readAndRolloverDailyCalls(host, 5, now);
		assert.equal(state.callsToday, 4);
		assert.equal(state.softWarning, true);
		assert.equal(state.limitReached, false);
	});

	it("limit reached blocks further calls (limitReached=true)", async () => {
		const host = mockHost();
		const now = new Date("2026-07-25T10:00:00+02:00");
		for (let i = 0; i < 5; i++) await recordDailyCall(host, 5, 0, now);
		const state = await readAndRolloverDailyCalls(host, 5, now);
		assert.equal(state.limitReached, true);
		assert.equal(state.softWarning, false);
	});

	it("resets counter and cost on a new local day", async () => {
		const host = mockHost();
		await recordDailyCall(host, 5, 1.23, new Date("2026-07-24T23:30:00+02:00"));
		const rolled = await readAndRolloverDailyCalls(host, 5, new Date("2026-07-25T00:30:00+02:00"));
		assert.equal(rolled.callsToday, 0);
		assert.equal(rolled.costTodayEur, 0);
		assert.equal(rolled.rolledOver, true);
	});

	it("clears previous-day AI display states on local midnight rollover", async () => {
		const host = mockHost({
			[AI_STATES.callsToday]: 3,
			[AI_STATES.callsTodayDate]: "2026-07-24",
			[AI_STATES.costEstimateTodayEur]: 0.05,
			[AI_STATES.lastThinkingDe]: "gestern gedacht",
			[AI_STATES.lastReasonDe]: "gestern begründet",
			[AI_STATES.lastDecisionsJson]: '[{"addonId":"battery"}]',
			[AI_STATES.lastSlotPreferencesJson]: '[{"addonId":"battery","weight":2}]',
			[AI_STATES.autoSuspended]: true,
			[AI_STATES.autoSuspendReasonDe]: "kein Vorteil",
		});
		const rolled = await readAndRolloverDailyCalls(host, 20, new Date("2026-07-25T00:05:00+02:00"));
		assert.equal(rolled.rolledOver, true);
		assert.equal(rolled.callsToday, 0);
		assert.equal((await host.getStateAsync(AI_STATES.lastThinkingDe))?.val, "");
		assert.equal((await host.getStateAsync(AI_STATES.lastReasonDe))?.val, "");
		assert.equal((await host.getStateAsync(AI_STATES.lastDecisionsJson))?.val, "[]");
		assert.equal((await host.getStateAsync(AI_STATES.lastSlotPreferencesJson))?.val, "[]");
		assert.equal((await host.getStateAsync(AI_STATES.autoSuspended))?.val, false);
		assert.equal((await host.getStateAsync(AI_STATES.autoSuspendReasonDe))?.val, "");
	});

	it("writes calls_limit and limit_warning states as a side effect", async () => {
		const host = mockHost();
		const now = new Date("2026-07-25T10:00:00+02:00");
		await readAndRolloverDailyCalls(host, 20, now);
		assert.equal((await host.getStateAsync(AI_STATES.callsLimit))?.val, 20);
		assert.equal((await host.getStateAsync(AI_STATES.limitWarning))?.val, false);
	});
});

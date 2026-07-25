import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAiStateChange, isAiRelatedState } from "./index.js";
import { AI_STATES } from "./ensure_states.js";
import { DAILY_PLAN_STATE_IDS } from "../operator/daily_plan/states.js";
import type { AiStateChangeHost } from "./index.js";

describe("ai state change routing", () => {
	it("isAiRelatedState only matches the optimize-now button id", () => {
		assert.equal(isAiRelatedState(AI_STATES.optimizeNowRequest), true);
		assert.equal(isAiRelatedState("ai.status"), false);
		assert.equal(isAiRelatedState("backup.export_request"), false);
	});

	it("ignores ack=true / val!=true / unrelated ids (no run, no ack-flip)", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		const host: AiStateChangeHost = {
			config: {},
			log: { debug() {}, warn() {}, error() {} },
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handledAckTrue = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, true, true);
		assert.equal(handledAckTrue, false);
		const handledFalseVal = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, false, false);
		assert.equal(handledFalseVal, false);
		const handledOther = await handleAiStateChange(host, "ai.status", true, false);
		assert.equal(handledOther, false);
	});

	it("val=true/ack=false → resets button and attempts a run (fail-closed: no plan → no throw)", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		const host: AiStateChangeHost = {
			config: {},
			log: { debug() {}, warn() {}, error() {} },
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handled = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, true, false);
		assert.equal(handled, true);
		assert.equal(store.get(AI_STATES.optimizeNowRequest), false);
		// no daily plan present in the mock host → runAiOptimizationManual resolves without throwing
		assert.equal(store.get(DAILY_PLAN_STATE_IDS.planJson), undefined);
	});
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FORECAST_PLAN_STATE_IDS } from "./states.js";
import {
	forecastPlanRevisionForTest,
	resetForecastPlanRevisionForTest,
	resolveForecastRevisionChangeForTest,
} from "./tick.js";
import { hasDeferredForecastPlanWrite } from "./deferred_writes.js";

function mockHost(initial: Record<string, ioBroker.StateValue> = {}) {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initial));
	return {
		store,
		config: {},
		log: { warn() {}, info() {} },
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("forecast revision persistence", () => {
	beforeEach(() => {
		resetForecastPlanRevisionForTest();
	});

	it("cold start with matching stored semantic hash keeps revision and skips rewrite", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "abc123",
			[FORECAST_PLAN_STATE_IDS.revision]: 7,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"abc123",
		);
		assert.equal(result.revisionChanged, false);
		assert.equal(result.skipLargeJsonWrites, true);
		assert.equal(result.skipReason, "stored_hash_match");
		assert.equal(result.nextRevision, 7);
		assert.equal(forecastPlanRevisionForTest(), 7);
	});

	it("cold start with different semantic hash bumps revision", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
			[FORECAST_PLAN_STATE_IDS.revision]: 2,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"new",
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.skipLargeJsonWrites, false);
		assert.equal(result.nextRevision, 1);
	});

	it("semantic hash change with deferLargeJsonWrites schedules deferred write path", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
			[FORECAST_PLAN_STATE_IDS.revision]: 2,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"new",
			true,
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.deferLargeJsonWrites, true);
		assert.equal(hasDeferredForecastPlanWrite(), false);
	});

	it("missing stored hash on cold start requires rewrite", async () => {
		const host = mockHost();
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"hash",
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.nextRevision, 1);
	});
});

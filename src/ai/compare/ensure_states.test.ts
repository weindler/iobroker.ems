import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMPARE_STATES, ensureCompareStates } from "./ensure_states.js";

function mockHost() {
	const objects = new Set<string>();
	const states = new Map<string, ioBroker.StateValue>();
	return {
		objects,
		states,
		host: {
			setObjectNotExistsAsync: async (id: string) => {
				objects.add(id);
			},
			getStateAsync: async (id: string) => {
				const v = states.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, st.val as ioBroker.StateValue);
			},
		},
	};
}

describe("ensureCompareStates", () => {
	it("creates the compare channel and all compare.* states with safe defaults", async () => {
		const mock = mockHost();
		await ensureCompareStates(mock.host);
		assert.ok(mock.objects.has("compare"));
		assert.ok(mock.objects.has("compare.plan_a"));
		assert.ok(mock.objects.has("compare.plan_b"));
		for (const id of Object.values(COMPARE_STATES)) {
			assert.ok(mock.objects.has(id), `expected object for ${id}`);
		}
		assert.equal(mock.states.get(COMPARE_STATES.activePlan), "a");
		assert.equal(mock.states.get(COMPARE_STATES.planAChartJson), "[]");
		assert.equal(mock.states.get(COMPARE_STATES.deltaSummaryJson), "{}");
	});
});

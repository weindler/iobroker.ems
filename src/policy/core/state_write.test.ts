import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setStateIfChanged } from "./state_write.js";
import type { StateHost } from "../../ems_light/state_util.js";

function mockHost(initial: Record<string, ioBroker.StateValue> = {}): StateHost & {
	writes: Array<{ id: string; val: ioBroker.StateValue }>;
} {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initial));
	return {
		writes: [],
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			this.writes.push({ id, val: state.val as ioBroker.StateValue });
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("policy state write", () => {
	it("unchanged value is not written", async () => {
		const host = mockHost({ "policy.global.revision": "abc" });
		const changed = await setStateIfChanged(host, "policy.global.revision", "abc");
		assert.equal(changed, false);
		assert.equal(host.writes.length, 0);
	});

	it("changed value is written", async () => {
		const host = mockHost({ "policy.global.revision": "abc" });
		const changed = await setStateIfChanged(host, "policy.global.revision", "def");
		assert.equal(changed, true);
		assert.equal(host.writes.length, 1);
	});
});

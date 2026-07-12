import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setStateIfChanged } from "./state_write.js";
import type { StateHost } from "../../ems_light/state_util.js";

function mockHost(initial: Record<string, ioBroker.StateValue> = {}): StateHost & {
	writes: Array<{ id: string; val: ioBroker.StateValue; ack: boolean }>;
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
			this.writes.push({
				id,
				val: state.val as ioBroker.StateValue,
				ack: state.ack ?? false,
			});
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

	it("skipRead writes without loading current state", async () => {
		const host = mockHost({ "planner.intent.forecast_plan.plan_json": "huge-old-payload" });
		let getCalls = 0;
		const origGet = host.getStateAsync.bind(host);
		host.getStateAsync = async (id: string) => {
			getCalls++;
			return origGet(id);
		};
		const changed = await setStateIfChanged(host, "planner.intent.forecast_plan.plan_json", "{}", {
			skipRead: true,
		});
		assert.equal(changed, true);
		assert.equal(getCalls, 0);
		assert.equal(host.writes.length, 1);
		assert.equal(host.writes[0].val, "{}");
		assert.equal(host.writes[0].ack, true);
	});

	it("missing state with unchanged revision still reads before first write", async () => {
		const host = mockHost();
		let getCalls = 0;
		const origGet = host.getStateAsync.bind(host);
		host.getStateAsync = async (id: string) => {
			getCalls++;
			return origGet(id);
		};
		const changed = await setStateIfChanged(host, "planner.intent.supply.grid.revision", 1);
		assert.equal(changed, true);
		assert.equal(getCalls, 1);
		assert.equal(host.writes.length, 1);
		assert.equal(host.writes[0].ack, true);
	});
});

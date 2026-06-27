import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	initIntentEngine,
	stopIntentEngine,
	handleIntentStateChange,
	resetIntentEngineForTest,
} from "./engine.js";
import type { IntentEngineHost } from "./engine.js";

function mockHost(): IntentEngineHost & {
	subscribeCount: number;
	unsubscribeCount: number;
	foreignSubscribeCount: number;
	patterns: string[];
	store: Map<string, { val: ioBroker.StateValue; ack: boolean }>;
} {
	const store = new Map<string, { val: ioBroker.StateValue; ack: boolean }>();
	return {
		subscribeCount: 0,
		unsubscribeCount: 0,
		foreignSubscribeCount: 0,
		patterns: [],
		store,
		config: {},
		namespace: "ems.0",
		log: { info() {}, warn() {}, debug() {} },
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			const e = store.get(id);
			return e === undefined ? null : ({ val: e.val, ack: e.ack } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, { val: state.val as ioBroker.StateValue, ack: state.ack ?? true });
		},
		async subscribeStatesAsync(pattern: string) {
			this.subscribeCount++;
			this.patterns.push(pattern);
		},
		async unsubscribeStatesAsync(pattern: string) {
			this.unsubscribeCount++;
			const i = this.patterns.indexOf(pattern);
			if (i >= 0) this.patterns.splice(i, 1);
		},
		async subscribeForeignStatesAsync() {
			this.foreignSubscribeCount++;
		},
		async unsubscribeForeignStatesAsync() {},
		async getForeignStateAsync() {
			return null;
		},
	};
}

describe("intent engine lifecycle", () => {
	beforeEach(() => {
		resetIntentEngineForTest();
	});

	it("subscribes request state once on init", async () => {
		const host = mockHost();
		await initIntentEngine(host);
		assert.equal(host.subscribeCount, 1);
		assert.ok(host.patterns.includes("user_intent.inputs.iobroker.wallbox.request_json"));
	});

	it("does not double-subscribe on repeated init", async () => {
		const host = mockHost();
		await initIntentEngine(host);
		await initIntentEngine(host);
		assert.equal(host.subscribeCount, 1);
	});

	it("unsubscribes on stop", async () => {
		const host = mockHost();
		await initIntentEngine(host);
		stopIntentEngine();
		await Promise.resolve();
		assert.equal(host.unsubscribeCount, 1);
	});

	it("re-init after stop works", async () => {
		const host = mockHost();
		await initIntentEngine(host);
		stopIntentEngine();
		await initIntentEngine(host);
		assert.equal(host.subscribeCount, 2);
	});

	it("handleIntentStateChange processes unacked request", async () => {
		const host = mockHost();
		await initIntentEngine(host);
		const req = {
			schema_version: 1,
			request_id: "lifecycle-1",
			issued_at: new Date().toISOString(),
			owner: { type: "user" },
			values: { charge_strategy: "pv" },
		};
		host.store.set("user_intent.inputs.iobroker.wallbox.request_json", {
			val: JSON.stringify(req),
			ack: false,
		});
		handleIntentStateChange("ems.0", "ems.0.user_intent.inputs.iobroker.wallbox.request_json", {
			val: JSON.stringify(req),
			ack: false,
		} as ioBroker.State);
		await new Promise((r) => setTimeout(r, 20));
		const result = host.store.get("user_intent.inputs.iobroker.wallbox.result_json");
		assert.ok(result);
		const parsed = JSON.parse(String(result!.val));
		assert.equal(parsed.status, "accepted");
	});
});

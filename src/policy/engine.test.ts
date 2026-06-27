import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	initPolicyEngine,
	stopPolicyEngine,
	handleGlobalModesStateChange,
	policyProviderRegistry,
} from "./engine.js";
import type { PolicyEngineHost } from "./engine.js";

function mockHost(): PolicyEngineHost & {
	subscribeCount: number;
	unsubscribeCount: number;
	subscribedPatterns: string[];
	store: Map<string, ioBroker.StateValue>;
} {
	const store = new Map<string, ioBroker.StateValue>();
	return {
		subscribeCount: 0,
		unsubscribeCount: 0,
		subscribedPatterns: [],
		store,
		config: {},
		log: {
			info() {},
			warn() {},
			debug() {},
		},
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
		async subscribeStatesAsync(pattern: string) {
			this.subscribeCount++;
			this.subscribedPatterns.push(pattern);
		},
		async unsubscribeStatesAsync(pattern: string) {
			this.unsubscribeCount++;
			const idx = this.subscribedPatterns.indexOf(pattern);
			if (idx >= 0) {
				this.subscribedPatterns.splice(idx, 1);
			}
		},
	};
}

describe("policy engine lifecycle", () => {
	beforeEach(() => {
		stopPolicyEngine();
		policyProviderRegistry.clear();
	});

	it("registers subscription exactly once on init", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		assert.equal(host.subscribeCount, 1);
		assert.deepEqual(host.subscribedPatterns, ["global_modes.requested"]);
	});

	it("does not double-subscribe on repeated init without stop", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		await initPolicyEngine(host);
		assert.equal(host.subscribeCount, 1);
	});

	it("removes subscription exactly once on stop", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		stopPolicyEngine();
		await Promise.resolve();
		assert.equal(host.unsubscribeCount, 1);
		assert.deepEqual(host.subscribedPatterns, []);
	});

	it("re-subscribes exactly once after stop and re-init", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		stopPolicyEngine();
		await Promise.resolve();
		await initPolicyEngine(host);
		assert.equal(host.subscribeCount, 2);
		assert.equal(host.unsubscribeCount, 1);
		assert.deepEqual(host.subscribedPatterns, ["global_modes.requested"]);
	});

	it("does not throw when unsubscribe rejects during stop", async () => {
		const host = mockHost();
		host.unsubscribeStatesAsync = async () => {
			throw new Error("unsubscribe failed");
		};
		await initPolicyEngine(host);
		assert.doesNotThrow(() => stopPolicyEngine());
		await Promise.resolve();
	});

	it("re-runs and updates active mode on global_modes.requested change", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		assert.equal(host.store.get("global_modes.active"), "balanced");

		host.store.set("global_modes.requested", "eco");
		handleGlobalModesStateChange("ems.0", "ems.0.global_modes.requested");
		await new Promise((r) => setTimeout(r, 5));

		assert.equal(host.store.get("global_modes.active"), "eco");
	});

	it("ignores unrelated state changes", async () => {
		const host = mockHost();
		await initPolicyEngine(host);
		host.store.set("global_modes.requested", "comfort");
		handleGlobalModesStateChange("ems.0", "ems.0.live.battery.soc_pct");
		await new Promise((r) => setTimeout(r, 5));
		assert.equal(host.store.get("global_modes.active"), "balanced");
	});
});

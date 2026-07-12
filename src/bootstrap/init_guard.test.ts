import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getModuleInitCounts, markModuleInit, resetModuleInitGuardForTest } from "../diagnostics/init_guard.js";
import { initIntentEngine, resetIntentEngineForTest, stopIntentEngine } from "../intent/engine.js";
import type { IntentEngineHost } from "../intent/engine.js";

function mockIntentHost(): IntentEngineHost {
	return {
		config: {},
		namespace: "ems.0",
		log: { info() {}, warn() {}, debug() {} },
		async setObjectNotExistsAsync() {},
		async getStateAsync() {
			return null;
		},
		async setStateAsync() {},
		async subscribeStatesAsync() {},
		async unsubscribeStatesAsync() {},
		async subscribeForeignStatesAsync() {},
		async unsubscribeForeignStatesAsync() {},
		async getForeignStateAsync() {
			return null;
		},
	};
}

describe("module init guard", () => {
	afterEach(() => {
		resetModuleInitGuardForTest();
		resetIntentEngineForTest();
		stopIntentEngine();
	});

	it("persist hydration marker increments once per explicit mark", () => {
		assert.equal(markModuleInit("persist_hydration").duplicate, false);
		assert.equal(markModuleInit("persist_hydration").duplicate, true);
		assert.equal(getModuleInitCounts().get("persist_hydration"), 2);
	});

	it("intent engine init is marked exactly once per initIntentEngine call", async () => {
		await initIntentEngine(mockIntentHost());
		assert.equal(getModuleInitCounts().get("intent_engine"), 1);
	});

	it("planner runtime marker increments once per explicit mark", () => {
		assert.equal(markModuleInit("planner_runtime").duplicate, false);
		assert.equal(markModuleInit("planner_runtime").duplicate, true);
		assert.equal(getModuleInitCounts().get("planner_runtime"), 2);
	});

	it("immersion runtime marker increments once per explicit mark", () => {
		assert.equal(markModuleInit("immersion_runtime").duplicate, false);
		assert.equal(markModuleInit("immersion_runtime").duplicate, true);
		assert.equal(getModuleInitCounts().get("immersion_runtime"), 2);
	});
});

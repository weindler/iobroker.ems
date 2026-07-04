import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	handleExecutionModeStateChange,
	isExecutionModeStateRelativeId,
	parseMode,
} from "./execution_mode.js";

describe("execution mode", () => {
	it("parseMode accepts live and defaults unknown to dryrun", () => {
		assert.equal(parseMode("live"), "live");
		assert.equal(parseMode("DRYRUN"), "dryrun");
		assert.equal(parseMode("invalid"), "dryrun");
	});

	it("detects execution mode state ids", () => {
		assert.equal(isExecutionModeStateRelativeId("global.execution_mode"), true);
		assert.equal(isExecutionModeStateRelativeId("addons.immersion_heater.mode"), true);
		assert.equal(isExecutionModeStateRelativeId("global_modes.requested"), false);
	});

	it("acks global execution mode from object tree", async () => {
		const store = new Map<string, ioBroker.State>();
		const adapter = {
			namespace: "ems.0",
			log: { info: () => {}, warn: () => {} },
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await handleExecutionModeStateChange(adapter, "ems.0.global.execution_mode", {
			val: "live",
			ack: false,
		} as ioBroker.State);
		assert.equal(store.get("global.execution_mode")?.val, "live");
		assert.equal(store.get("global.execution_mode")?.ack, true);
		assert.equal(store.get("execution.safety.global_execution_mode")?.val, "live");
	});

	it("acks addon execution mode from object tree", async () => {
		const store = new Map<string, ioBroker.State>();
		const adapter = {
			namespace: "ems.0",
			log: { info: () => {}, warn: () => {} },
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await handleExecutionModeStateChange(adapter, "ems.0.addons.immersion_heater.mode", {
			val: "live",
			ack: false,
		} as ioBroker.State);
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get("addons.immersion_heater.mode")?.ack, true);
	});
});

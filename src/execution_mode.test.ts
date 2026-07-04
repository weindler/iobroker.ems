import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	EXECUTION_MODE_CONFIG_FINGERPRINT,
	executionModesConfigFingerprint,
	handleExecutionModeStateChange,
	isExecutionModeStateRelativeId,
	parseMode,
	syncExecutionModesFromConfig,
} from "./execution_mode.js";

const DRYRUN_FP = executionModesConfigFingerprint({
	global_execution_mode: "dryrun",
	wb_addon_mode: "dryrun",
	bat_addon_mode: "dryrun",
	ih_addon_mode: "dryrun",
});

const LIVE_IH_FP = executionModesConfigFingerprint({
	global_execution_mode: "live",
	wb_addon_mode: "dryrun",
	bat_addon_mode: "dryrun",
	ih_addon_mode: "live",
});

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

	it("syncExecutionModesFromConfig preserves runtime modes when admin unchanged", async () => {
		const store = new Map<string, ioBroker.State>([
			["global.execution_mode", { val: "live", ack: true } as ioBroker.State],
			["addons.immersion_heater.mode", { val: "live", ack: true } as ioBroker.State],
			["addons.battery.mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.wallbox.mode", { val: "dryrun", ack: true } as ioBroker.State],
			[EXECUTION_MODE_CONFIG_FINGERPRINT, { val: DRYRUN_FP, ack: true } as ioBroker.State],
		]);
		const host = {
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await syncExecutionModesFromConfig(host, {
			global_execution_mode: "dryrun",
			ih_addon_mode: "dryrun",
			bat_addon_mode: "dryrun",
			wb_addon_mode: "dryrun",
		});
		assert.equal(store.get("global.execution_mode")?.val, "live");
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get("execution.safety.global_execution_mode")?.val, "live");
	});

	it("syncExecutionModesFromConfig applies admin when config changed", async () => {
		const store = new Map<string, ioBroker.State>([
			["global.execution_mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.immersion_heater.mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.battery.mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.wallbox.mode", { val: "dryrun", ack: true } as ioBroker.State],
			[EXECUTION_MODE_CONFIG_FINGERPRINT, { val: DRYRUN_FP, ack: true } as ioBroker.State],
		]);
		const host = {
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await syncExecutionModesFromConfig(host, {
			global_execution_mode: "live",
			ih_addon_mode: "live",
			bat_addon_mode: "dryrun",
			wb_addon_mode: "dryrun",
		});
		assert.equal(store.get("global.execution_mode")?.val, "live");
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get(EXECUTION_MODE_CONFIG_FINGERPRINT)?.val, LIVE_IH_FP);
	});

	it("syncExecutionModesFromConfig seeds empty states from admin config", async () => {
		const store = new Map<string, ioBroker.State>();
		const host = {
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await syncExecutionModesFromConfig(host, {
			global_execution_mode: "live",
			ih_addon_mode: "live",
			bat_addon_mode: "dryrun",
			wb_addon_mode: "dryrun",
		});
		assert.equal(store.get("global.execution_mode")?.val, "live");
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get("addons.battery.mode")?.val, "dryrun");
		assert.equal(store.get(EXECUTION_MODE_CONFIG_FINGERPRINT)?.val, LIVE_IH_FP);
	});
});

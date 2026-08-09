import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	EXECUTION_MODE_CONFIG_FINGERPRINT,
	executionModeConfigKeyForRelativeId,
	executionModesConfigFingerprint,
	handleExecutionModeStateChange,
	isExecutionModeStateRelativeId,
	parseMode,
	persistExecutionModeToAdminConfig,
	syncExecutionModesFromConfig,
} from "./execution_mode.js";

const DRYRUN_FP = executionModesConfigFingerprint({
	global_execution_mode: "dryrun",
	wb_addon_mode: "dryrun",
	bat_addon_mode: "dryrun",
	ih_addon_mode: "dryrun",
	ac_addon_mode: "dryrun",
});

const LIVE_IH_FP = executionModesConfigFingerprint({
	global_execution_mode: "live",
	wb_addon_mode: "dryrun",
	bat_addon_mode: "dryrun",
	ih_addon_mode: "live",
	ac_addon_mode: "dryrun",
});

describe("execution mode", () => {
	it("parseMode accepts live/off and defaults unknown to dryrun", () => {
		assert.equal(parseMode("live"), "live");
		assert.equal(parseMode("off"), "off");
		assert.equal(parseMode("DRYRUN"), "dryrun");
		assert.equal(parseMode("invalid"), "dryrun");
	});

	it("detects execution mode state ids", () => {
		assert.equal(isExecutionModeStateRelativeId("global.execution_mode"), true);
		assert.equal(isExecutionModeStateRelativeId("addons.immersion_heater.mode"), true);
		assert.equal(isExecutionModeStateRelativeId("global_modes.requested"), false);
	});

	it("acks global execution mode from object tree without cascading addon modes", async () => {
		const store = new Map<string, ioBroker.State>([
			["addons.immersion_heater.mode", { val: "live", ack: true } as ioBroker.State],
			["addons.air_conditioning.mode", { val: "dryrun", ack: true } as ioBroker.State],
			["addons.battery.mode", { val: "live", ack: true } as ioBroker.State],
			["addons.wallbox.mode", { val: "dryrun", ack: true } as ioBroker.State],
		]);
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
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get("addons.air_conditioning.mode")?.val, "dryrun");
		assert.equal(store.get("addons.battery.mode")?.val, "live");
		assert.equal(store.get("addons.wallbox.mode")?.val, "dryrun");
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
			["addons.air_conditioning.mode", { val: "dryrun", ack: true } as ioBroker.State],
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
			ac_addon_mode: "dryrun",
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
			ac_addon_mode: "dryrun",
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
			ac_addon_mode: "dryrun",
			bat_addon_mode: "dryrun",
			wb_addon_mode: "dryrun",
		});
		assert.equal(store.get("global.execution_mode")?.val, "live");
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "live");
		assert.equal(store.get("addons.battery.mode")?.val, "dryrun");
		assert.equal(store.get(EXECUTION_MODE_CONFIG_FINGERPRINT)?.val, LIVE_IH_FP);
	});

	it("persistExecutionModeToAdminConfig maps state ids to config keys", () => {
		assert.equal(executionModeConfigKeyForRelativeId("global.execution_mode"), "global_execution_mode");
		assert.equal(executionModeConfigKeyForRelativeId("addons.battery.mode"), "bat_addon_mode");
		assert.equal(executionModeConfigKeyForRelativeId("addons.immersion_heater.mode"), "ih_addon_mode");
	});

	it("persistExecutionModeToAdminConfig writes back to admin native", async () => {
		const store = new Map<string, ioBroker.State>();
		let config: Record<string, unknown> = { ih_addon_mode: "dryrun" };
		const adapter = {
			config,
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
			updateConfig: async (next: Record<string, unknown>) => {
				config = next;
			},
		};
		const updated = await persistExecutionModeToAdminConfig(
			adapter,
			"addons.immersion_heater.mode",
			"live",
		);
		assert.equal(updated, true);
		assert.equal(config.ih_addon_mode, "live");
	});

	it("syncExecutionModesFromConfig cold start recovery clamps live admin config to dryrun", async () => {
		const store = new Map<string, ioBroker.State>();
		let config: Record<string, unknown> = {
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		};
		const host = {
			log: { info: () => {}, debug: () => {} },
			config,
			updateConfig: async (next: Record<string, unknown>) => {
				config = next;
			},
			getStateAsync: async (id: string) => store.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, { val: st.val, ack: st.ack ?? false } as ioBroker.State);
			},
			setObjectNotExistsAsync: async () => undefined,
		};
		await syncExecutionModesFromConfig(host, config, { coldStartRecovery: true });
		assert.equal(store.get("global.execution_mode")?.val, "dryrun");
		assert.equal(store.get("addons.wallbox.mode")?.val, "dryrun");
		assert.equal(store.get("addons.battery.mode")?.val, "dryrun");
		assert.equal(store.get("addons.immersion_heater.mode")?.val, "dryrun");
		assert.equal(store.get("addons.air_conditioning.mode")?.val, "dryrun");
		assert.equal(store.get("execution.safety.global_execution_mode")?.val, "dryrun");
		assert.equal(config.global_execution_mode, "dryrun");
		assert.equal(config.wb_addon_mode, "dryrun");
	});
});

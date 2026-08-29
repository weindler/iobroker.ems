import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { stopBatteryModule } from "../addons/battery/index.js";
import { stopAirConditioningModule } from "../addons/air_conditioning/index.js";
import { stopImmersionHeaterModule } from "../addons/immersion_heater/index.js";
import { stopMeasuredConsumersModule } from "../addons/measured_consumers/index.js";
import { stopWallboxModule } from "../addons/wallbox/index.js";
import { stopEmsLightPhase1 } from "../ems_light/index.js";
import { stopFailsafeRunner } from "../failsafe_runner.js";
import { WALLBOX_LIVE_WRITE_RELEASED } from "../addons/wallbox/runtime/execute.js";
import { resetAllProfileSocPersistence } from "../addons/wallbox/vehicles/baseline.js";
import { IMMERSION_RUNTIME_STATES } from "../addons/immersion_heater/runtime/types.js";
import {
	allBootstrapCoreStateIds,
	BOOTSTRAP_CORE_STATE_CATEGORIES,
	LEGACY_WALLBOX_VEHICLE_SLOT_PREFIXES,
} from "./manifest.js";
import { ensureStaticStateTree, ensureDynamicVehicleProfiles, cleanupDynamicPlaceholders } from "./ensure_static_tree.js";
import { endBootstrapRun } from "./context.js";
import { hydratePersistedState } from "./persist_hydrate.js";
import { runPostBootstrapReconciliation } from "./reconcile.js";
import {
	getBootstrapRunContext,
	isBootstrapComplete,
	resetBootstrapBarrierForTest,
	runAdapterBootstrap,
} from "./startup.js";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states.js";

type MockState = { val: ioBroker.StateValue; ack: boolean };

function defaultConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		global_execution_mode: "dryrun",
		wb_addon_mode: "dryrun",
		bat_addon_mode: "dryrun",
		ih_addon_mode: "dryrun",
		ac_addon_mode: "dryrun",
		wb_vehicle_map: [],
		...overrides,
	};
}

function mapRow(evccId: string, name: string): Record<string, unknown> {
	return {
		evcc_vehicle_id: evccId,
		display_name: name,
		enabled: true,
		battery_capacity_net_kwh: 60,
		max_ac_charge_power_w: 11000,
	};
}

function liveConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return defaultConfig({
		global_execution_mode: "live",
		wb_addon_mode: "live",
		bat_addon_mode: "live",
		ih_addon_mode: "live",
		ac_addon_mode: "live",
		...overrides,
	});
}

function immersionConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return defaultConfig({
		ih_set_enabled_target: "relay.0.heater",
		ih_buffer_temp_c_target: "sensor.0.buffer_temp",
		ih_buffer_temp_c_enabled: true,
		...overrides,
	});
}

class FakeBootstrapAdapter {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	readonly states = new Map<string, MockState>();
	readonly subscriptions: string[] = [];
	readonly foreignSubscriptions: string[] = [];
	readonly foreignWrites: Array<{ id: string; val: unknown }> = [];
	readonly foreignStates = new Map<string, MockState>();
	config: Record<string, unknown>;
	common = { version: "0.1.140" };
	private dataDir: string;

	constructor(dataDir: string, config: Record<string, unknown> = defaultConfig()) {
		this.dataDir = dataDir;
		this.config = config;
	}

	log = {
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
	};

	getAbsoluteInstanceDataDir(): string {
		return this.dataDir;
	}

	async setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<void> {
		if (!this.objects.has(id)) {
			this.objects.set(id, { ...obj, _id: id } as ioBroker.Object);
		}
		if (obj.type === "state" && obj.common?.def !== undefined && !this.states.has(id)) {
			this.states.set(id, { val: obj.common.def as ioBroker.StateValue, ack: true });
		}
	}

	async extendObjectAsync(id: string, obj: Partial<ioBroker.Object>): Promise<void> {
		const cur = this.objects.get(id);
		if (cur && obj.common) {
			cur.common = { ...(cur.common as ioBroker.StateCommon), ...(obj.common as ioBroker.StateCommon) };
		}
	}

	async getObjectAsync(id: string): Promise<ioBroker.Object | null> {
		return this.objects.get(id) ?? null;
	}

	async delObjectAsync(id: string, options?: { recursive?: boolean }): Promise<void> {
		if (options?.recursive) {
			const prefix = `${id}.`;
			for (const key of [...this.objects.keys()]) {
				if (key === id || key.startsWith(prefix)) {
					this.objects.delete(key);
					this.states.delete(key);
				}
			}
			return;
		}
		this.objects.delete(id);
		this.states.delete(id);
	}

	async getObjectListAsync(params: {
		startkey: string;
		endkey: string;
	}): Promise<{ rows: Array<{ id: string }> }> {
		const ns = `${this.namespace}.`;
		const startRel = params.startkey.startsWith(ns) ? params.startkey.slice(ns.length) : params.startkey;
		const endRel = params.endkey.startsWith(ns) ? params.endkey.slice(ns.length) : params.endkey;
		const rows: Array<{ id: string }> = [];
		for (const id of this.objects.keys()) {
			if (id >= startRel && id <= endRel) {
				rows.push({ id: `${ns}${id}` });
			}
		}
		return { rows };
	}

	async getStateAsync(id: string): Promise<ioBroker.State | null> {
		const s = this.states.get(id);
		return s ? ({ val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } as ioBroker.State) : null;
	}

	/** Wie echter Adapter: Native-Config persistieren (Cold-Start/Restore Dryrun-Klemme). */
	async updateConfig(newConfig: Record<string, unknown>): Promise<void> {
		this.config = { ...this.config, ...newConfig };
	}

	async setStateAsync(id: string, st: ioBroker.SettableState): Promise<void> {
		this.states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack ?? false });
	}

	async getForeignStateAsync(id: string): Promise<ioBroker.State | null> {
		const s = this.foreignStates.get(id);
		return s ? ({ val: s.val, ack: s.ack, ts: 0, lc: 0, from: "test" } as ioBroker.State) : null;
	}

	async setForeignStateAsync(id: string, st: ioBroker.SettableState): Promise<void> {
		this.foreignWrites.push({ id, val: st.val });
	}

	async subscribeStatesAsync(pattern: string): Promise<void> {
		if (!this.subscriptions.includes(pattern)) {
			this.subscriptions.push(pattern);
		}
	}

	async subscribeForeignStatesAsync(pattern: string): Promise<void> {
		if (!this.foreignSubscriptions.includes(pattern)) {
			this.foreignSubscriptions.push(pattern);
		}
	}

	async unsubscribeStatesAsync(_pattern: string): Promise<void> {
		return undefined;
	}

	async unsubscribeForeignStatesAsync(_pattern: string): Promise<void> {
		return undefined;
	}

	async getHistoryAsync(): Promise<Array<{ val: ioBroker.StateValue; ts: number }>> {
		return [];
	}

	hasObject(relativeId: string): boolean {
		return this.objects.has(relativeId);
	}
}

async function strictStep(_label: string, fn: () => Promise<unknown>): Promise<void> {
	await fn();
}

async function stopAllRuntime(): Promise<void> {
	await stopEmsLightPhase1();
	stopWallboxModule();
	stopBatteryModule(null);
	stopImmersionHeaterModule();
	stopAirConditioningModule();
	stopMeasuredConsumersModule();
	stopFailsafeRunner();
	resetBootstrapBarrierForTest();
	endBootstrapRun();
	resetAllProfileSocPersistence();
}

function assertCoreCategories(adapter: FakeBootstrapAdapter): void {
	for (const [category, ids] of Object.entries(BOOTSTRAP_CORE_STATE_CATEGORIES)) {
		for (const id of ids) {
			assert.ok(adapter.hasObject(id), `${category}: missing object ${id}`);
		}
	}
}

describe("bootstrap cold start recovery", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-bootstrap-"));
	});

	afterEach(async () => {
		await stopAllRuntime();
	});

	it("scenario A — empty namespace, empty vehicle mini-map", async () => {
		const adapter = new FakeBootstrapAdapter(tmp, defaultConfig({ wb_vehicle_map: [] }));
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);

		assert.equal(isBootstrapComplete(), true);
		assertCoreCategories(adapter);
		assert.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
		assert.equal(adapter.states.get("addons.wallbox.mode")?.val, "dryrun");
		assert.equal(adapter.foreignWrites.length, 0);
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);

		for (const prefix of LEGACY_WALLBOX_VEHICLE_SLOT_PREFIXES) {
			for (const id of adapter.objects.keys()) {
				assert.ok(!id.startsWith(prefix), `legacy slot object must not exist: ${id}`);
			}
		}
		const vehicleChannels = [...adapter.objects.keys()].filter((id) =>
			id.startsWith("addons.wallbox.vehicles."),
		);
		assert.equal(vehicleChannels.length, 0, "no fat vehicle profile trees");
	});

	it("scenario B — mini-map entries do not create vehicle state trees", async () => {
		for (const count of [1, 5]) {
			await stopAllRuntime();
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ems-bootstrap-vp-"));
			const entries = Array.from({ length: count }, (_, i) =>
				mapRow(`evcc_car_${i + 1}`, `Car ${i + 1}`),
			);
			const adapter = new FakeBootstrapAdapter(dir, defaultConfig({ wb_vehicle_map: entries }));
			await ensureStaticStateTree(adapter as unknown as ioBroker.Adapter);
			await ensureDynamicVehicleProfiles(adapter as unknown as ioBroker.Adapter);

			const vehicleChannels = [...adapter.objects.keys()].filter((id) =>
				id.startsWith("addons.wallbox.vehicles."),
			);
			assert.equal(vehicleChannels.length, 0, "mini-map must not create fat vehicle trees");
		}
	});

	it("scenario C — idempotent second start preserves user values", async () => {
		const adapter = new FakeBootstrapAdapter(tmp);
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);
		await adapter.setStateAsync("global.execution_mode", { val: "dryrun", ack: true });
		await adapter.setStateAsync("global_modes.requested", { val: "eco", ack: true });
		const snapshotObjects = new Map(adapter.objects);
		const snapshotStates = new Map(adapter.states);
		const snapshotSubs = [...adapter.subscriptions];

		await stopAllRuntime();
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);

		assert.equal(adapter.objects.size, snapshotObjects.size);
		assert.equal(adapter.states.get("global_modes.requested")?.val, "eco");
		assert.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
		for (const sub of snapshotSubs) {
			assert.ok(adapter.subscriptions.includes(sub), `subscription preserved: ${sub}`);
		}
	});

	it("scenario D — partial namespace fills gaps and keeps valid user values", async () => {
		const adapter = new FakeBootstrapAdapter(tmp);
		await adapter.setObjectNotExistsAsync("global.execution_mode", {
			type: "state",
			common: { name: "Global mode", type: "string", role: "value", read: true, write: true, def: "dryrun" },
			native: {},
		} as ioBroker.Object);
		await adapter.setStateAsync("global.execution_mode", { val: "dryrun", ack: true });
		await adapter.setObjectNotExistsAsync("global_modes.requested", {
			type: "state",
			common: { name: "Requested", type: "string", role: "value", read: true, write: true },
			native: {},
		} as ioBroker.Object);
		await adapter.setStateAsync("global_modes.requested", { val: "balanced", ack: true });
		await adapter.setStateAsync("learning.persistence.battery_runtime_json", {
			val: "{invalid-json",
			ack: true,
		});

		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);

		assert.equal(isBootstrapComplete(), true);
		assert.equal(adapter.states.get("global_modes.requested")?.val, "balanced");
		for (const id of allBootstrapCoreStateIds()) {
			assert.ok(adapter.hasObject(id), `filled missing core object ${id}`);
		}
		assert.equal(adapter.foreignWrites.length, 0);
	});

	it("scenario E — full phase order A→B→C→D→Sync→E→F→Complete", async () => {
		const order: string[] = [];
		const adapter = new FakeBootstrapAdapter(tmp);
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep, {
			trace: (phase, detail) => order.push(detail ? `${phase}:${detail}` : phase),
		});

		const phases = ["A:", "B:", "C:", "D:", "sync:", "E:", "F:", "complete:"];
		let lastIdx = -1;
		for (const prefix of phases) {
			const idx = order.findIndex((x) => x.startsWith(prefix));
			assert.ok(idx > lastIdx, `missing or out-of-order ${prefix} in ${order.join(" -> ")}`);
			lastIdx = idx;
		}
	});

	it("scenario F — empty namespace with live admin config clamps to dryrun", async () => {
		const cfg = liveConfig({ wb_vehicle_map: [] });
		const adapter = new FakeBootstrapAdapter(tmp, cfg);
		let coldStartDuringSync: boolean | null = null;
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, async (label, fn) => {
			await fn();
			if (label === "sync execution modes") {
				coldStartDuringSync = getBootstrapRunContext()?.coldStartRecovery ?? null;
			}
		});

		assert.equal(isBootstrapComplete(), true);
		assert.equal(coldStartDuringSync, true);
		assert.equal(getBootstrapRunContext(), null);
		// Beta: Cold-Start klemmt Native + States auf dryrun (keine Admin↔Baum-Divergenz).
		assert.equal(adapter.config.global_execution_mode, "dryrun");
		assert.equal(adapter.config.wb_addon_mode, "dryrun");
		assert.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
		assert.equal(adapter.states.get("addons.wallbox.mode")?.val, "dryrun");
		assert.equal(adapter.states.get("addons.battery.mode")?.val, "dryrun");
		assert.equal(adapter.states.get("addons.immersion_heater.mode")?.val, "dryrun");
		assert.equal(adapter.states.get("addons.air_conditioning.mode")?.val, "dryrun");
		assert.equal(adapter.states.get("execution.safety.global_execution_mode")?.val, "dryrun");
		assert.equal(adapter.foreignWrites.length, 0);
		assert.equal(WALLBOX_LIVE_WRITE_RELEASED, true);
	});

	it("scenario F2 — second start with existing namespace is warm start", async () => {
		const cfg = liveConfig({ wb_vehicle_map: [] });
		const adapter = new FakeBootstrapAdapter(tmp, cfg);
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);
		assert.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");

		await stopAllRuntime();
		let secondRunColdStart: boolean | null = null;
		const subsBefore = adapter.subscriptions.length;
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, async (label, fn) => {
			await fn();
			if (label === "sync execution modes") {
				secondRunColdStart = getBootstrapRunContext()?.coldStartRecovery ?? null;
			}
		});

		assert.equal(secondRunColdStart, false);
		assert.equal(adapter.states.get("global.execution_mode")?.val, "dryrun");
		assert.equal(adapter.subscriptions.length, subsBefore);
	});

	it("scenario G — foreign input during bootstrap is reconciled after barrier", async () => {
		const adapter = new FakeBootstrapAdapter(
			tmp,
			defaultConfig({ wb_evcc_connected_state: "evcc.0.status.connected" }),
		);
		let foreignSetDuringBootstrap = false;

		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, async (label, fn) => {
			await fn();
			if (label === "wallbox runtime" && !foreignSetDuringBootstrap) {
				adapter.foreignStates.set("evcc.0.status.connected", { val: true, ack: true });
				foreignSetDuringBootstrap = true;
			}
		});

		assert.equal(isBootstrapComplete(), true);
		assert.equal(adapter.foreignWrites.length, 0);
		assert.equal(adapter.states.get(WALLBOX_EVCC_STATES.connected)?.val, true);
	});

	it("scenario G2 — post-bootstrap reconciliation picks up late foreign changes", async () => {
		const adapter = new FakeBootstrapAdapter(
			tmp,
			defaultConfig({ wb_evcc_connected_state: "evcc.0.status.connected" }),
		);
		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, strictStep);
		adapter.foreignStates.set("evcc.0.status.connected", { val: true, ack: true });
		await runPostBootstrapReconciliation(adapter as unknown as ioBroker.Adapter);
		assert.equal(adapter.states.get(WALLBOX_EVCC_STATES.connected)?.val, true);
		assert.equal(adapter.foreignWrites.length, 0);
	});

	it("scenario H — Phase D hydrate skips fat vehicle SOC persistence", async () => {
		const adapter = new FakeBootstrapAdapter(
			tmp,
			defaultConfig({ wb_vehicle_map: [mapRow("evcc_car", "Car 1")] }),
		);
		await ensureStaticStateTree(adapter as unknown as ioBroker.Adapter);
		await ensureDynamicVehicleProfiles(adapter as unknown as ioBroker.Adapter);
		await hydratePersistedState(adapter as unknown as ioBroker.Adapter);

		const vehicleChannels = [...adapter.objects.keys()].filter((id) =>
			id.startsWith("addons.wallbox.vehicles."),
		);
		assert.equal(vehicleChannels.length, 0);
	});

	it("scenario I — immersion foreign input during bootstrap reconciled after barrier", async () => {
		const adapter = new FakeBootstrapAdapter(tmp, immersionConfig());
		let foreignSetDuringBootstrap = false;
		const foreignWritesDuringBootstrap: Array<{ id: string; val: unknown }> = [];

		await runAdapterBootstrap(adapter as unknown as ioBroker.Adapter, async (label, fn) => {
			await fn();
			if (label === "immersion runtime" && !foreignSetDuringBootstrap) {
				foreignWritesDuringBootstrap.push(...adapter.foreignWrites);
				adapter.foreignStates.set("sensor.0.buffer_temp", { val: 52.5, ack: true });
				foreignSetDuringBootstrap = true;
			}
		});

		assert.equal(isBootstrapComplete(), true);
		assert.equal(foreignSetDuringBootstrap, true);
		assert.equal(foreignWritesDuringBootstrap.length, 0);
		assert.equal(adapter.states.get(IMMERSION_RUNTIME_STATES.bufferTemperatureC)?.val, 52.5);
		const dupes = adapter.subscriptions.filter((s, i) => adapter.subscriptions.indexOf(s) !== i);
		assert.equal(dupes.length, 0, "no duplicate subscriptions");
	});

	it("productive surface stays within budget (empty config)", async () => {
		const adapter = new FakeBootstrapAdapter(tmp);
		await ensureStaticStateTree(adapter as unknown as ioBroker.Adapter);
		await cleanupDynamicPlaceholders(adapter as unknown as ioBroker.Adapter);
		const byType: Record<string, number> = {};
		const byArea: Record<string, number> = {};
		for (const [id, obj] of adapter.objects) {
			const t = obj.type ?? "unknown";
			byType[t] = (byType[t] ?? 0) + 1;
			const area = id.split(".")[0] ?? id;
			if (obj.type === "state") {
				byArea[area] = (byArea[area] ?? 0) + 1;
			}
		}
		const states = byType.state ?? 0;
		const channels = byType.channel ?? 0;
		console.log(`empty-config surface states=${states} channels=${channels} areas=${JSON.stringify(byArea)}`);
		/*
		 * Historisch 350–550. Stand Aug 2026 (leere Config): ~604 States —
		 * Wachstum durch Statistik-Objektbaum, Planner-Diagnostik, Ownership/Reserve,
		 * AI/Backup — nicht durch Measured-Consumer-Leer-Slots.
		 * Obergrenze 650: knappe Kopfreserve (~7 %), State-Explosionen bleiben sichtbar.
		 */
		assert.ok(
			states <= 650,
			`empty-config states=${states} channels=${channels} areas=${JSON.stringify(byArea)}`,
		);
		assert.ok(states >= 250, `unexpectedly small surface states=${states}`);
		assert.ok(
			![...adapter.objects.keys()].some((id) => id.includes("addons.measured_consumers")),
			"empty measured_consumers config must not create consumer/aggregate states",
		);
		assert.ok(![...adapter.objects.keys()].some((id) => id.includes(".mapping.")), "mapping shadows remain");
		assert.ok(!adapter.objects.has("planner.intent.last_json"));
		assert.ok(!adapter.objects.has("addons.wallbox.runtime.connected"));
		assert.ok(!adapter.objects.has("addons.wallbox.status.evcc.snapshot_json"));
	});
});

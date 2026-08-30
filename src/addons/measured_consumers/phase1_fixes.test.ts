import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyTauchpumpeWhResetMigration,
	TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY,
	TAUCHPUMPE_WH_RESET_MIGRATION_ID,
	readMeasuredConsumersPersist,
	writeMeasuredConsumersPersist,
} from "./persist_io.js";
import { emptyMeasuredConsumerSlotPersist } from "./persist.js";
import {
	runMeasuredConsumersTick,
	resetMeasuredConsumersEngineForTest,
	type MeasuredConsumersRuntimeHost,
} from "./runtime/engine.js";
import { MEASURED_CONSUMERS_CONFIG_KEY, MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID } from "./constants.js";
import { MEASURED_CONSUMERS_AGGREGATE_STATES, measuredConsumerSlotStateIds } from "./runtime/state_ids.js";
import { DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write.js";

class FakeHost implements MeasuredConsumersRuntimeHost {
	states = new Map<string, ioBroker.StateValue>();
	objects = new Map<string, ioBroker.Object>();
	config: Record<string, unknown>;
	baseDir: string;
	log = {
		info: () => undefined,
		warn: () => undefined,
		debug: () => undefined,
		error: () => undefined,
	};
	/** Simuliert: Foreign-Lookup scheitert für relative IDs. */
	foreignFailsRelative = false;

	constructor(config: Record<string, unknown>, baseDir: string) {
		this.config = config;
		this.baseDir = baseDir;
	}

	getAbsolutePath = () => this.baseDir;
	getStateAsync = async (id: string) => {
		if (!this.states.has(id)) return null;
		return { val: this.states.get(id), ack: true } as ioBroker.State;
	};
	getForeignStateAsync = async (id: string) => {
		if (this.foreignFailsRelative && !id.includes(".")) return null;
		if (this.foreignFailsRelative && id.startsWith("live.")) return null;
		return this.getStateAsync(id);
	};
	getForeignObjectAsync = async (id: string) => this.objects.get(id) ?? null;
	getObjectAsync = async (id: string) => this.objects.get(id) ?? null;
	setStateAsync = async (id: string, st: ioBroker.SettableState) => {
		this.states.set(id, st.val as ioBroker.StateValue);
		return null;
	};
	setObjectNotExistsAsync = async () => null;
	extendObjectAsync = async () => null;
	set(id: string, val: ioBroker.StateValue): void {
		this.states.set(id, val);
	}
}

async function val(host: FakeHost, id: string): Promise<unknown> {
	return (await host.getStateAsync(id))?.val;
}

describe("measured_consumers phase1 fixes", () => {
	it("house_load lokal lesen trotz Foreign-Fail", async () => {
		resetMeasuredConsumersEngineForTest();
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-hl-"));
		try {
			const host = new FakeHost(
				{
					[MEASURED_CONSUMERS_CONFIG_KEY]: [
						{ enabled: true, name: "TV", power_state_id: "sensor.tv", energy_state_id: "", initial_energy_kwh: "" },
					],
				},
				dir,
			);
			host.foreignFailsRelative = true;
			host.set("sensor.tv", 100);
			host.set(MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID, 500);
			await runMeasuredConsumersTick(host);
			assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadW), 500);
			assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadAvailable), true);
			assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.unknownHouseLoadW), 400);
		} finally {
			resetMeasuredConsumersEngineForTest();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Tauchpumpe-Migration resettet nur diesen Slot", () => {
		const otherKey = "sensor.other_power";
		const persist = {
			version: 1 as const,
			slots: {
				[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
					initialized: true,
					rawEnergyBaselineKwh: 131659.5,
					lastPowerTsMs: null,
					totalKwh: 125,
					days: { "2026-08-29": 23.76, "2026-08-30": 101.8 },
				},
				[otherKey]: {
					initialized: true,
					rawEnergyBaselineKwh: 50,
					lastPowerTsMs: null,
					totalKwh: 50,
					days: { "2026-08-30": 0.5 },
				},
			},
			migrationsApplied: [] as string[],
		};
		const { persist: next, reset } = applyTauchpumpeWhResetMigration(persist);
		assert.equal(reset, true);
		assert.deepEqual(next.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], emptyMeasuredConsumerSlotPersist());
		assert.equal(next.slots[otherKey].totalKwh, 50);
		assert.equal(next.slots[otherKey].days["2026-08-30"], 0.5);
		assert.ok(next.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));
		const again = applyTauchpumpeWhResetMigration(next);
		assert.equal(again.reset, false);
	});

	it("Init mit initial_energy_kwh nach Tauchpumpen-Reset", async () => {
		resetMeasuredConsumersEngineForTest();
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-init-"));
		try {
			await writeMeasuredConsumersPersist(dir, {
				version: 1,
				slots: {
					[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
						initialized: true,
						rawEnergyBaselineKwh: 131659,
						lastPowerTsMs: null,
						totalKwh: 200,
						days: { "2026-08-30": 101 },
					},
				},
				migrationsApplied: [],
			});
			const loaded = await readMeasuredConsumersPersist(dir);
			assert.equal(loaded.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY].initialized, false);
			assert.deepEqual(loaded.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY].days, {});

			const host = new FakeHost(
				{
					timezone: "Europe/Berlin",
					[MEASURED_CONSUMERS_CONFIG_KEY]: [
						{
							enabled: true,
							name: "Tauchpumpe",
							power_state_id: TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY,
							energy_state_id: "sensor.tauch_e",
							initial_energy_kwh: "131.66",
						},
					],
				},
				dir,
			);
			host.set(TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY, 50);
			host.set("sensor.tauch_e", 131.8);
			host.objects.set("sensor.tauch_e", {
				_id: "sensor.tauch_e",
				type: "state",
				common: { name: "e", type: "number", role: "value", read: true, write: false, unit: "kWh" },
				native: {},
			} as ioBroker.Object);

			await runMeasuredConsumersTick(host);
			const ids = measuredConsumerSlotStateIds(1);
			assert.equal(await val(host, ids.energyTotalKwh), 131.66);
			assert.equal(await val(host, ids.energyTodayKwh), 0);
			host.set("sensor.tauch_e", 132.0);
			await runMeasuredConsumersTick(host);
			assert.equal(await val(host, ids.energyTodayKwh), 0.2);
		} finally {
			resetMeasuredConsumersEngineForTest();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Wh-Unit → Warnung in reason_de, keine Umrechnung", async () => {
		resetMeasuredConsumersEngineForTest();
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-wh-"));
		try {
			const host = new FakeHost(
				{
					[MEASURED_CONSUMERS_CONFIG_KEY]: [
						{
							enabled: true,
							name: "X",
							power_state_id: "sensor.p",
							energy_state_id: "sensor.e",
							initial_energy_kwh: "",
						},
					],
				},
				dir,
			);
			host.set("sensor.p", 10);
			host.set("sensor.e", 5);
			host.objects.set("sensor.e", {
				_id: "sensor.e",
				type: "state",
				common: { name: "e", type: "number", role: "value", read: true, write: false, unit: "Wh" },
				native: {},
			} as ioBroker.Object);
			await runMeasuredConsumersTick(host);
			const ids = measuredConsumerSlotStateIds(1);
			const reason = String(await val(host, ids.reasonDe));
			assert.match(reason, /Wh/);
			assert.match(reason, /kWh/);
		} finally {
			resetMeasuredConsumersEngineForTest();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Persist-Write Dateimode 0644", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-mode-"));
		try {
			await writeMeasuredConsumersPersist(dir, {
				version: 1,
				slots: {},
				migrationsApplied: [TAUCHPUMPE_WH_RESET_MIGRATION_ID],
			});
			const st = await fs.stat(path.join(dir, "measured_consumers_runtime_v1.json"));
			assert.equal(st.mode & 0o777, DIAGNOSTIC_FILE_MODE);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});

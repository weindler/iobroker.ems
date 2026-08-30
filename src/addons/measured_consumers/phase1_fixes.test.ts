import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyTauchpumpeWhResetMigration,
	persistTauchpumpeWhResetMigrationIfNeeded,
	TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY,
	TAUCHPUMPE_WH_RESET_MIGRATION_ID,
	readMeasuredConsumersPersist,
	writeMeasuredConsumersPersist,
} from "./persist_io.js";
import {
	runMeasuredConsumersTick,
	resetMeasuredConsumersEngineForTest,
	hydrateMeasuredConsumersPersist,
	type MeasuredConsumersRuntimeHost,
} from "./runtime/engine.js";
import { MEASURED_CONSUMERS_CONFIG_KEY, MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID } from "./constants.js";
import { MEASURED_CONSUMERS_AGGREGATE_STATES, measuredConsumerSlotStateIds } from "./runtime/state_ids.js";
import { DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write.js";
import { MEASURED_CONSUMERS_RUNTIME_FILENAME } from "./persist.js";

class FakeHost implements MeasuredConsumersRuntimeHost {
	states = new Map<string, ioBroker.StateValue>();
	objects = new Map<string, ioBroker.Object>();
	config: Record<string, unknown>;
	baseDir: string;
	log = {
		info: (_m?: string) => undefined,
		warn: (_m?: string) => undefined,
		debug: (_m?: string) => undefined,
		error: (_m?: string) => undefined,
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

	it("Tauchpumpe-Migration: nur Zielslot entfernt, andere wertgleich", () => {
		const otherKey = "sensor.other_power";
		const otherSlot = {
			initialized: true,
			rawEnergyBaselineKwh: 50,
			lastPowerTsMs: null as number | null,
			totalKwh: 50,
			days: { "2026-08-30": 0.5 },
		};
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
				[otherKey]: { ...otherSlot, days: { ...otherSlot.days } },
			},
			migrationsApplied: [] as string[],
		};
		const r = applyTauchpumpeWhResetMigration(persist);
		assert.equal(r.changed, true);
		assert.equal(r.matched, true);
		assert.equal(r.alreadyApplied, false);
		assert.equal(r.previousRawEnergyBaselineKwh, 131659.5);
		assert.equal(r.persist.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], undefined);
		assert.deepEqual(r.persist.slots[otherKey], otherSlot);
		assert.ok(r.persist.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));
		const again = applyTauchpumpeWhResetMigration(r.persist);
		assert.equal(again.changed, false);
		assert.equal(again.alreadyApplied, true);
	});

	it("Tauchpumpe-Migration: Slot fehlt → No-op mit Marker (changed)", () => {
		const persist = {
			version: 1 as const,
			slots: {
				"sensor.other": {
					initialized: true,
					rawEnergyBaselineKwh: 1,
					lastPowerTsMs: null,
					totalKwh: 1,
					days: {},
				},
			},
			migrationsApplied: [] as string[],
		};
		const r = applyTauchpumpeWhResetMigration(persist);
		assert.equal(r.matched, false);
		assert.equal(r.changed, true);
		assert.equal(r.persist.slots["sensor.other"].totalKwh, 1);
		assert.ok(r.persist.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));
	});

	it("Tauchpumpe-Migration sofort persistiert + idempotent nach Reload", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-mig-"));
		try {
			const otherKey = "sensor.other_power";
			await writeMeasuredConsumersPersist(dir, {
				version: 1,
				slots: {
					[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
						initialized: true,
						rawEnergyBaselineKwh: 131659.441,
						lastPowerTsMs: null,
						totalKwh: 125.482,
						days: { "2026-08-29": 23.76, "2026-08-30": 101.722 },
					},
					[otherKey]: {
						initialized: true,
						rawEnergyBaselineKwh: 10,
						lastPowerTsMs: null,
						totalKwh: 10,
						days: { "2026-08-30": 0.1 },
					},
				},
				migrationsApplied: [],
			});
			const loaded = await readMeasuredConsumersPersist(dir);
			assert.equal(loaded.migrationsApplied?.length ?? 0, 0);
			assert.ok(loaded.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]);

			const after = await persistTauchpumpeWhResetMigrationIfNeeded(dir, loaded, {
				log: { info: () => undefined },
			});
			assert.equal(after.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], undefined);
			assert.equal(after.slots[otherKey].totalKwh, 10);
			assert.ok(after.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));

			const disk = await readMeasuredConsumersPersist(dir);
			assert.equal(disk.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], undefined);
			assert.deepEqual(disk.slots[otherKey].days, { "2026-08-30": 0.1 });
			assert.ok(disk.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));

			const again = await persistTauchpumpeWhResetMigrationIfNeeded(dir, disk);
			assert.equal(again.slots[otherKey].totalKwh, 10);
			assert.equal(Object.keys(again.slots).length, 1);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Tauchpumpe-Migration: Write-Fehler → kein Marker auf Disk", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-migfail-"));
		try {
			const bad = {
				version: 1 as const,
				slots: {
					[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
						initialized: true,
						rawEnergyBaselineKwh: 131659,
						lastPowerTsMs: null,
						totalKwh: 100,
						days: { "2026-08-30": 101 },
					},
				},
				migrationsApplied: [] as string[],
			};
			const goodDir = path.join(dir, "good");
			await fs.mkdir(goodDir);
			await writeMeasuredConsumersPersist(goodDir, bad);
			/* baseDir ist eine Datei → mkdir/Write schlägt fehl */
			const blocked = path.join(dir, "blocked");
			await fs.writeFile(blocked, "not-a-directory");
			const kept = await persistTauchpumpeWhResetMigrationIfNeeded(blocked, bad, {
				log: { warn: () => undefined },
			});
			assert.equal(kept.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]?.totalKwh, 100);
			assert.equal(kept.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID), false);
			const disk = await readMeasuredConsumersPersist(goodDir);
			assert.equal(disk.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]?.days["2026-08-30"], 101);
			assert.equal(disk.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID) ?? false, false);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("Init mit initial_energy_kwh nach Tauchpumpen-Reset via Hydrate", async () => {
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
			const infos: string[] = [];
			host.log.info = (m?: string) => {
				if (m) infos.push(m);
				return undefined;
			};
			host.set(TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY, 50);
			host.set("sensor.tauch_e", 131.8);
			host.objects.set("sensor.tauch_e", {
				_id: "sensor.tauch_e",
				type: "state",
				common: { name: "e", type: "number", role: "value", read: true, write: false, unit: "kWh" },
				native: {},
			} as ioBroker.Object);

			await hydrateMeasuredConsumersPersist(host);
			assert.ok(infos.some((m) => m.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID) && m.includes("persisted")));
			const diskAfterHydrate = await readMeasuredConsumersPersist(dir);
			assert.equal(diskAfterHydrate.slots[TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], undefined);
			assert.ok(diskAfterHydrate.migrationsApplied?.includes(TAUCHPUMPE_WH_RESET_MIGRATION_ID));

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

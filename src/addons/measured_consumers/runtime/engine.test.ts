import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	runMeasuredConsumersTick,
	resetMeasuredConsumersEngineForTest,
	type MeasuredConsumersRuntimeHost,
} from "./engine";
import { measuredConsumerSlotStateIds, MEASURED_CONSUMERS_AGGREGATE_STATES } from "./state_ids";
import { MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID, MEASURED_CONSUMERS_CONFIG_KEY } from "../constants";

/** Arrow-Function-Properties, weil engine.ts Reader teils entbunden aufruft. */
class FakeHost implements MeasuredConsumersRuntimeHost {
	config: unknown;
	log = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
	getAbsolutePath?: (category?: string) => string;
	private states = new Map<string, ioBroker.State>();

	constructor(config: unknown, baseDir?: string) {
		this.config = config;
		if (baseDir) {
			this.getAbsolutePath = () => baseDir;
		}
	}

	set = (id: string, val: ioBroker.StateValue): void => {
		this.states.set(id, { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 } as ioBroker.State);
	};
	setObjectNotExistsAsync = async (): Promise<unknown> => undefined;
	extendObjectAsync = async (): Promise<unknown> => undefined;
	getStateAsync = async (id: string): Promise<ioBroker.State | null | undefined> => this.states.get(id) ?? null;
	getForeignStateAsync = async (id: string): Promise<ioBroker.State | null | undefined> => this.states.get(id) ?? null;
	setStateAsync = async (id: string, state: ioBroker.SettableState): Promise<unknown> => {
		const val = state && typeof state === "object" && "val" in state ? (state as { val: ioBroker.StateValue }).val : null;
		this.set(id, val ?? null);
		return undefined;
	};
}

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return { enabled: true, name: "Verbraucher", power_state_id: "", energy_state_id: "", initial_energy_kwh: "", ...overrides };
}

async function val(host: FakeHost, id: string): Promise<unknown> {
	return (await host.getStateAsync(id))?.val;
}

describe("measured_consumers/runtime/engine", () => {
	beforeEach(() => {
		resetMeasuredConsumersEngineForTest();
	});

	it("C/H) mehrere Verbraucher: Summe total_power_w korrekt", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				row({ name: "TV", power_state_id: "sensor.tv_power" }),
				row({ name: "Receiver", power_state_id: "sensor.receiver_power" }),
			],
		});
		host.set("sensor.tv_power", 120);
		host.set("sensor.receiver_power", 30);

		await runMeasuredConsumersTick(host);

		const ids1 = measuredConsumerSlotStateIds(1);
		const ids2 = measuredConsumerSlotStateIds(2);
		assert.equal(await val(host, ids1.powerW), 120);
		assert.equal(await val(host, ids1.valid), true);
		assert.equal(await val(host, ids2.powerW), 30);
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 150);
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.activeSlotCount), 2);
	});

	it("I) Doppelzählung: Hauslast 1000 W, TV 120 W, Receiver 30 W => unknown 850 W, Hauslast bleibt 1000 W", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				row({ name: "TV", power_state_id: "sensor.tv_power" }),
				row({ name: "Receiver", power_state_id: "sensor.receiver_power" }),
			],
		});
		host.set("sensor.tv_power", 120);
		host.set("sensor.receiver_power", 30);
		host.set(MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID, 1000);

		await runMeasuredConsumersTick(host);

		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 150);
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.unknownHouseLoadW), 850);
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadW), 1000, "Hauslast bleibt unverändert, niemals 1150");
	});

	it("J) deaktivierter Verbraucher: nicht in Aggregaten/Statistik", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				row({ name: "TV", power_state_id: "sensor.tv_power" }),
				row({ name: "Mikrowelle", power_state_id: "sensor.mw_power", enabled: false }),
			],
		});
		host.set("sensor.tv_power", 120);
		host.set("sensor.mw_power", 900);

		await runMeasuredConsumersTick(host);

		const ids2 = measuredConsumerSlotStateIds(2);
		assert.equal(await val(host, ids2.enabled), false);
		assert.equal(await val(host, ids2.valid), false);
		assert.equal(await val(host, ids2.reasonDe), "Deaktiviert");
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 120, "deaktivierter Slot fließt nicht ein");
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.activeSlotCount), 1);
	});

	it("K) ungültiger/unavailable Power-State: kein Phantomverbrauch, valid=false", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Unbekannt", power_state_id: "sensor.missing" })],
		});
		// State existiert nicht (kein host.set aufgerufen)

		await runMeasuredConsumersTick(host);

		const ids = measuredConsumerSlotStateIds(1);
		assert.equal(await val(host, ids.valid), false);
		assert.equal(await val(host, ids.powerW), null);
		assert.equal(await val(host, ids.energyTotalKwh), 0);
		assert.equal(await val(host, ids.reasonDe), "Leistungs-Datenpunkt nicht verfügbar");
	});

	it("negative Leistung wird robust auf 0 geklemmt statt übernommen", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Fehlerhaft", power_state_id: "sensor.neg" })],
		});
		host.set("sensor.neg", -42);

		await runMeasuredConsumersTick(host);

		const ids = measuredConsumerSlotStateIds(1);
		assert.equal(await val(host, ids.powerW), 0);
		assert.equal(await val(host, ids.valid), false);
	});

	it("kein Leistungs-Datenpunkt konfiguriert: valid=false, kein Absturz", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Leer", power_state_id: "" })],
		});
		await runMeasuredConsumersTick(host);
		const ids = measuredConsumerSlotStateIds(1);
		assert.equal(await val(host, ids.valid), false);
		assert.equal(await val(host, ids.reasonDe), "Kein Leistungs-Datenpunkt konfiguriert");
	});

	it("L) 20 Slots: generische Verarbeitung, 21. Zeile wird ignoriert", async () => {
		const rows = Array.from({ length: 21 }, (_, i) =>
			row({ name: `Verbraucher ${i + 1}`, power_state_id: `sensor.p${i + 1}` }),
		);
		const host = new FakeHost({ [MEASURED_CONSUMERS_CONFIG_KEY]: rows });
		for (let i = 1; i <= 21; i++) host.set(`sensor.p${i}`, 10);

		await runMeasuredConsumersTick(host);

		const ids20 = measuredConsumerSlotStateIds(20);
		assert.equal(await val(host, ids20.powerW), 10, "Slot 20 wird noch verarbeitet");
		assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 200, "genau 20 Slots fließen ein, nicht 21");
	});

	it("C) Energy-State: bestehender Rohzähler wird korrekt übernommen", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e" }),
			],
		});
		host.set("sensor.p", 50);
		host.set("sensor.e", 87.4);

		await runMeasuredConsumersTick(host);

		const ids = measuredConsumerSlotStateIds(1);
		assert.equal(await val(host, ids.energyTotalKwh), 87.4);
		assert.equal(await val(host, ids.sourceMode), "energy_state");
	});

	it("D) Startwert: initial_energy_kwh wird als EMS-Gesamtstand übernommen", async () => {
		const host = new FakeHost({
			[MEASURED_CONSUMERS_CONFIG_KEY]: [
				row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e", initial_energy_kwh: "512.3" }),
			],
		});
		host.set("sensor.p", 10);
		host.set("sensor.e", 12.0);

		await runMeasuredConsumersTick(host);

		const ids = measuredConsumerSlotStateIds(1);
		assert.equal(await val(host, ids.energyTotalKwh), 512.3);
	});

	describe("F) Adapter-Neustart: kein Energieverlust / keine Doppelinitialisierung", () => {
		let tmpDir: string;

		beforeEach(async () => {
			tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-test-"));
		});
		afterEach(async () => {
			await fs.rm(tmpDir, { recursive: true, force: true });
		});

		it("Persist überlebt einen simulierten Neustart", async () => {
			const config = {
				[MEASURED_CONSUMERS_CONFIG_KEY]: [
					row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e", initial_energy_kwh: "500" }),
				],
			};
			const host1 = new FakeHost(config, tmpDir);
			host1.set("sensor.p", 10);
			host1.set("sensor.e", 1.0);
			await runMeasuredConsumersTick(host1);
			const ids = measuredConsumerSlotStateIds(1);
			assert.equal(await val(host1, ids.energyTotalKwh), 500, "erstes Sample übernimmt initial_energy_kwh als Gesamtstand");
			assert.equal(await val(host1, ids.energyTodayKwh), 0, "erster Sample: today = 0");

			// Simulierter Adapter-Neustart: Engine-Singleton zurücksetzen, neue Host-Instanz
			resetMeasuredConsumersEngineForTest();
			const host2 = new FakeHost(config, tmpDir);
			host2.set("sensor.p", 10);
			host2.set("sensor.e", 1.0);
			await runMeasuredConsumersTick(host2);
			assert.equal(await val(host2, ids.energyTotalKwh), 500, "unveränderter Rohzähler: kein zusätzlicher Verbrauch");
			assert.equal(await val(host2, ids.energyTodayKwh), 0, "unveränderter Rohzähler: today bleibt 0");

			host2.set("sensor.e", 1.1);
			await runMeasuredConsumersTick(host2);
			assert.equal(await val(host2, ids.energyTotalKwh), 500.1);
			assert.equal(await val(host2, ids.energyTodayKwh), 0.1, "nach Neustart +0.1 → today exakt +0.1");
		});

		it("energy_state 100→100.2 schreibt today und Monat/Jahr", async () => {
			const config = {
				[MEASURED_CONSUMERS_CONFIG_KEY]: [
					row({ name: "PC", power_state_id: "sensor.p", energy_state_id: "sensor.e" }),
				],
			};
			const host = new FakeHost(config, tmpDir);
			host.set("sensor.p", 123);
			host.set("sensor.e", 100.0);
			await runMeasuredConsumersTick(host);
			const ids = measuredConsumerSlotStateIds(1);
			assert.equal(await val(host, ids.energyTodayKwh), 0);

			host.set("sensor.e", 100.2);
			await runMeasuredConsumersTick(host);
			assert.equal(await val(host, ids.energyTotalKwh), 100.2);
			assert.equal(await val(host, ids.energyTodayKwh), 0.2);
			assert.equal(await val(host, ids.energyMonthKwh), 0.2);
			assert.equal(await val(host, ids.energyYearKwh), 0.2);
			assert.equal(await val(host, MEASURED_CONSUMERS_AGGREGATE_STATES.totalEnergyTodayKwh), 0.2);
		});
	});
});

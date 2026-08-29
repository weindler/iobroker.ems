"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const engine_1 = require("./engine");
const state_ids_1 = require("./state_ids");
const constants_1 = require("../constants");
/** Arrow-Function-Properties, weil engine.ts Reader teils entbunden aufruft. */
class FakeHost {
    config;
    log = { info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined };
    getAbsolutePath;
    states = new Map();
    constructor(config, baseDir) {
        this.config = config;
        if (baseDir) {
            this.getAbsolutePath = () => baseDir;
        }
    }
    set = (id, val) => {
        this.states.set(id, { val, ack: true, ts: Date.now(), lc: Date.now(), from: "test", q: 0 });
    };
    setObjectNotExistsAsync = async () => undefined;
    extendObjectAsync = async () => undefined;
    getStateAsync = async (id) => this.states.get(id) ?? null;
    getForeignStateAsync = async (id) => this.states.get(id) ?? null;
    setStateAsync = async (id, state) => {
        const val = state && typeof state === "object" && "val" in state ? state.val : null;
        this.set(id, val ?? null);
        return undefined;
    };
}
function row(overrides = {}) {
    return { enabled: true, name: "Verbraucher", power_state_id: "", energy_state_id: "", initial_energy_kwh: "", ...overrides };
}
async function val(host, id) {
    return (await host.getStateAsync(id))?.val;
}
(0, node_test_1.describe)("measured_consumers/runtime/engine", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_1.resetMeasuredConsumersEngineForTest)();
    });
    (0, node_test_1.it)("C/H) mehrere Verbraucher: Summe total_power_w korrekt", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                row({ name: "TV", power_state_id: "sensor.tv_power" }),
                row({ name: "Receiver", power_state_id: "sensor.receiver_power" }),
            ],
        });
        host.set("sensor.tv_power", 120);
        host.set("sensor.receiver_power", 30);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids1 = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        const ids2 = (0, state_ids_1.measuredConsumerSlotStateIds)(2);
        strict_1.default.equal(await val(host, ids1.powerW), 120);
        strict_1.default.equal(await val(host, ids1.valid), true);
        strict_1.default.equal(await val(host, ids2.powerW), 30);
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 150);
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.activeSlotCount), 2);
    });
    (0, node_test_1.it)("I) Doppelzählung: Hauslast 1000 W, TV 120 W, Receiver 30 W => unknown 850 W, Hauslast bleibt 1000 W", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                row({ name: "TV", power_state_id: "sensor.tv_power" }),
                row({ name: "Receiver", power_state_id: "sensor.receiver_power" }),
            ],
        });
        host.set("sensor.tv_power", 120);
        host.set("sensor.receiver_power", 30);
        host.set(constants_1.MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID, 1000);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 150);
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.unknownHouseLoadW), 850);
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadW), 1000, "Hauslast bleibt unverändert, niemals 1150");
    });
    (0, node_test_1.it)("J) deaktivierter Verbraucher: nicht in Aggregaten/Statistik", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                row({ name: "TV", power_state_id: "sensor.tv_power" }),
                row({ name: "Mikrowelle", power_state_id: "sensor.mw_power", enabled: false }),
            ],
        });
        host.set("sensor.tv_power", 120);
        host.set("sensor.mw_power", 900);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids2 = (0, state_ids_1.measuredConsumerSlotStateIds)(2);
        strict_1.default.equal(await val(host, ids2.enabled), false);
        strict_1.default.equal(await val(host, ids2.valid), false);
        strict_1.default.equal(await val(host, ids2.reasonDe), "Deaktiviert");
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 120, "deaktivierter Slot fließt nicht ein");
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.activeSlotCount), 1);
    });
    (0, node_test_1.it)("K) ungültiger/unavailable Power-State: kein Phantomverbrauch, valid=false", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Unbekannt", power_state_id: "sensor.missing" })],
        });
        // State existiert nicht (kein host.set aufgerufen)
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        strict_1.default.equal(await val(host, ids.valid), false);
        strict_1.default.equal(await val(host, ids.powerW), null);
        strict_1.default.equal(await val(host, ids.energyTotalKwh), 0);
        strict_1.default.equal(await val(host, ids.reasonDe), "Leistungs-Datenpunkt nicht verfügbar");
    });
    (0, node_test_1.it)("negative Leistung wird robust auf 0 geklemmt statt übernommen", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Fehlerhaft", power_state_id: "sensor.neg" })],
        });
        host.set("sensor.neg", -42);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        strict_1.default.equal(await val(host, ids.powerW), 0);
        strict_1.default.equal(await val(host, ids.valid), false);
    });
    (0, node_test_1.it)("kein Leistungs-Datenpunkt konfiguriert: valid=false, kein Absturz", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [row({ name: "Leer", power_state_id: "" })],
        });
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        strict_1.default.equal(await val(host, ids.valid), false);
        strict_1.default.equal(await val(host, ids.reasonDe), "Kein Leistungs-Datenpunkt konfiguriert");
    });
    (0, node_test_1.it)("L) 20 Slots: generische Verarbeitung, 21. Zeile wird ignoriert", async () => {
        const rows = Array.from({ length: 21 }, (_, i) => row({ name: `Verbraucher ${i + 1}`, power_state_id: `sensor.p${i + 1}` }));
        const host = new FakeHost({ [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: rows });
        for (let i = 1; i <= 21; i++)
            host.set(`sensor.p${i}`, 10);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids20 = (0, state_ids_1.measuredConsumerSlotStateIds)(20);
        strict_1.default.equal(await val(host, ids20.powerW), 10, "Slot 20 wird noch verarbeitet");
        strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalPowerW), 200, "genau 20 Slots fließen ein, nicht 21");
    });
    (0, node_test_1.it)("C) Energy-State: bestehender Rohzähler wird korrekt übernommen", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e" }),
            ],
        });
        host.set("sensor.p", 50);
        host.set("sensor.e", 87.4);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        strict_1.default.equal(await val(host, ids.energyTotalKwh), 87.4);
        strict_1.default.equal(await val(host, ids.sourceMode), "energy_state");
    });
    (0, node_test_1.it)("D) Startwert: initial_energy_kwh wird als EMS-Gesamtstand übernommen", async () => {
        const host = new FakeHost({
            [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e", initial_energy_kwh: "512.3" }),
            ],
        });
        host.set("sensor.p", 10);
        host.set("sensor.e", 12.0);
        await (0, engine_1.runMeasuredConsumersTick)(host);
        const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
        strict_1.default.equal(await val(host, ids.energyTotalKwh), 512.3);
    });
    (0, node_test_1.describe)("F) Adapter-Neustart: kein Energieverlust / keine Doppelinitialisierung", () => {
        let tmpDir;
        (0, node_test_1.beforeEach)(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-test-"));
        });
        (0, node_test_1.afterEach)(async () => {
            await fs.rm(tmpDir, { recursive: true, force: true });
        });
        (0, node_test_1.it)("Persist überlebt einen simulierten Neustart", async () => {
            const config = {
                [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                    row({ name: "Steckdose", power_state_id: "sensor.p", energy_state_id: "sensor.e", initial_energy_kwh: "500" }),
                ],
            };
            const host1 = new FakeHost(config, tmpDir);
            host1.set("sensor.p", 10);
            host1.set("sensor.e", 1.0);
            await (0, engine_1.runMeasuredConsumersTick)(host1);
            const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
            strict_1.default.equal(await val(host1, ids.energyTotalKwh), 500, "erstes Sample übernimmt initial_energy_kwh als Gesamtstand");
            strict_1.default.equal(await val(host1, ids.energyTodayKwh), 0, "erster Sample: today = 0");
            // Simulierter Adapter-Neustart: Engine-Singleton zurücksetzen, neue Host-Instanz
            (0, engine_1.resetMeasuredConsumersEngineForTest)();
            const host2 = new FakeHost(config, tmpDir);
            host2.set("sensor.p", 10);
            host2.set("sensor.e", 1.0);
            await (0, engine_1.runMeasuredConsumersTick)(host2);
            strict_1.default.equal(await val(host2, ids.energyTotalKwh), 500, "unveränderter Rohzähler: kein zusätzlicher Verbrauch");
            strict_1.default.equal(await val(host2, ids.energyTodayKwh), 0, "unveränderter Rohzähler: today bleibt 0");
            host2.set("sensor.e", 1.1);
            await (0, engine_1.runMeasuredConsumersTick)(host2);
            strict_1.default.equal(await val(host2, ids.energyTotalKwh), 500.1);
            strict_1.default.equal(await val(host2, ids.energyTodayKwh), 0.1, "nach Neustart +0.1 → today exakt +0.1");
        });
        (0, node_test_1.it)("energy_state 100→100.2 schreibt today und Monat/Jahr", async () => {
            const config = {
                [constants_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                    row({ name: "PC", power_state_id: "sensor.p", energy_state_id: "sensor.e" }),
                ],
            };
            const host = new FakeHost(config, tmpDir);
            host.set("sensor.p", 123);
            host.set("sensor.e", 100.0);
            await (0, engine_1.runMeasuredConsumersTick)(host);
            const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(1);
            strict_1.default.equal(await val(host, ids.energyTodayKwh), 0);
            host.set("sensor.e", 100.2);
            await (0, engine_1.runMeasuredConsumersTick)(host);
            strict_1.default.equal(await val(host, ids.energyTotalKwh), 100.2);
            strict_1.default.equal(await val(host, ids.energyTodayKwh), 0.2);
            strict_1.default.equal(await val(host, ids.energyMonthKwh), 0.2);
            strict_1.default.equal(await val(host, ids.energyYearKwh), 0.2);
            strict_1.default.equal(await val(host, state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES.totalEnergyTodayKwh), 0.2);
        });
    });
});

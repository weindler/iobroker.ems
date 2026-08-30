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
const persist_io_js_1 = require("./persist_io.js");
const persist_js_1 = require("./persist.js");
const engine_js_1 = require("./runtime/engine.js");
const constants_js_1 = require("./constants.js");
const state_ids_js_1 = require("./runtime/state_ids.js");
const atomic_write_js_1 = require("../../persistence/atomic_write.js");
class FakeHost {
    states = new Map();
    objects = new Map();
    config;
    baseDir;
    log = {
        info: () => undefined,
        warn: () => undefined,
        debug: () => undefined,
        error: () => undefined,
    };
    /** Simuliert: Foreign-Lookup scheitert für relative IDs. */
    foreignFailsRelative = false;
    constructor(config, baseDir) {
        this.config = config;
        this.baseDir = baseDir;
    }
    getAbsolutePath = () => this.baseDir;
    getStateAsync = async (id) => {
        if (!this.states.has(id))
            return null;
        return { val: this.states.get(id), ack: true };
    };
    getForeignStateAsync = async (id) => {
        if (this.foreignFailsRelative && !id.includes("."))
            return null;
        if (this.foreignFailsRelative && id.startsWith("live."))
            return null;
        return this.getStateAsync(id);
    };
    getForeignObjectAsync = async (id) => this.objects.get(id) ?? null;
    getObjectAsync = async (id) => this.objects.get(id) ?? null;
    setStateAsync = async (id, st) => {
        this.states.set(id, st.val);
        return null;
    };
    setObjectNotExistsAsync = async () => null;
    extendObjectAsync = async () => null;
    set(id, val) {
        this.states.set(id, val);
    }
}
async function val(host, id) {
    return (await host.getStateAsync(id))?.val;
}
(0, node_test_1.describe)("measured_consumers phase1 fixes", () => {
    (0, node_test_1.it)("house_load lokal lesen trotz Foreign-Fail", async () => {
        (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-hl-"));
        try {
            const host = new FakeHost({
                [constants_js_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                    { enabled: true, name: "TV", power_state_id: "sensor.tv", energy_state_id: "", initial_energy_kwh: "" },
                ],
            }, dir);
            host.foreignFailsRelative = true;
            host.set("sensor.tv", 100);
            host.set(constants_js_1.MEASURED_CONSUMERS_HOUSE_LOAD_STATE_ID, 500);
            await (0, engine_js_1.runMeasuredConsumersTick)(host);
            strict_1.default.equal(await val(host, state_ids_js_1.MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadW), 500);
            strict_1.default.equal(await val(host, state_ids_js_1.MEASURED_CONSUMERS_AGGREGATE_STATES.houseLoadAvailable), true);
            strict_1.default.equal(await val(host, state_ids_js_1.MEASURED_CONSUMERS_AGGREGATE_STATES.unknownHouseLoadW), 400);
        }
        finally {
            (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Tauchpumpe-Migration resettet nur diesen Slot", () => {
        const otherKey = "sensor.other_power";
        const persist = {
            version: 1,
            slots: {
                [persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
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
            migrationsApplied: [],
        };
        const { persist: next, reset } = (0, persist_io_js_1.applyTauchpumpeWhResetMigration)(persist);
        strict_1.default.equal(reset, true);
        strict_1.default.deepEqual(next.slots[persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY], (0, persist_js_1.emptyMeasuredConsumerSlotPersist)());
        strict_1.default.equal(next.slots[otherKey].totalKwh, 50);
        strict_1.default.equal(next.slots[otherKey].days["2026-08-30"], 0.5);
        strict_1.default.ok(next.migrationsApplied?.includes(persist_io_js_1.TAUCHPUMPE_WH_RESET_MIGRATION_ID));
        const again = (0, persist_io_js_1.applyTauchpumpeWhResetMigration)(next);
        strict_1.default.equal(again.reset, false);
    });
    (0, node_test_1.it)("Init mit initial_energy_kwh nach Tauchpumpen-Reset", async () => {
        (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-init-"));
        try {
            await (0, persist_io_js_1.writeMeasuredConsumersPersist)(dir, {
                version: 1,
                slots: {
                    [persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY]: {
                        initialized: true,
                        rawEnergyBaselineKwh: 131659,
                        lastPowerTsMs: null,
                        totalKwh: 200,
                        days: { "2026-08-30": 101 },
                    },
                },
                migrationsApplied: [],
            });
            const loaded = await (0, persist_io_js_1.readMeasuredConsumersPersist)(dir);
            strict_1.default.equal(loaded.slots[persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY].initialized, false);
            strict_1.default.deepEqual(loaded.slots[persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY].days, {});
            const host = new FakeHost({
                timezone: "Europe/Berlin",
                [constants_js_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                    {
                        enabled: true,
                        name: "Tauchpumpe",
                        power_state_id: persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY,
                        energy_state_id: "sensor.tauch_e",
                        initial_energy_kwh: "131.66",
                    },
                ],
            }, dir);
            host.set(persist_io_js_1.TAUCHPUMPE_MEASURED_CONSUMER_POWER_KEY, 50);
            host.set("sensor.tauch_e", 131.8);
            host.objects.set("sensor.tauch_e", {
                _id: "sensor.tauch_e",
                type: "state",
                common: { name: "e", type: "number", role: "value", read: true, write: false, unit: "kWh" },
                native: {},
            });
            await (0, engine_js_1.runMeasuredConsumersTick)(host);
            const ids = (0, state_ids_js_1.measuredConsumerSlotStateIds)(1);
            strict_1.default.equal(await val(host, ids.energyTotalKwh), 131.66);
            strict_1.default.equal(await val(host, ids.energyTodayKwh), 0);
            host.set("sensor.tauch_e", 132.0);
            await (0, engine_js_1.runMeasuredConsumersTick)(host);
            strict_1.default.equal(await val(host, ids.energyTodayKwh), 0.2);
        }
        finally {
            (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Wh-Unit → Warnung in reason_de, keine Umrechnung", async () => {
        (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-wh-"));
        try {
            const host = new FakeHost({
                [constants_js_1.MEASURED_CONSUMERS_CONFIG_KEY]: [
                    {
                        enabled: true,
                        name: "X",
                        power_state_id: "sensor.p",
                        energy_state_id: "sensor.e",
                        initial_energy_kwh: "",
                    },
                ],
            }, dir);
            host.set("sensor.p", 10);
            host.set("sensor.e", 5);
            host.objects.set("sensor.e", {
                _id: "sensor.e",
                type: "state",
                common: { name: "e", type: "number", role: "value", read: true, write: false, unit: "Wh" },
                native: {},
            });
            await (0, engine_js_1.runMeasuredConsumersTick)(host);
            const ids = (0, state_ids_js_1.measuredConsumerSlotStateIds)(1);
            const reason = String(await val(host, ids.reasonDe));
            strict_1.default.match(reason, /Wh/);
            strict_1.default.match(reason, /kWh/);
        }
        finally {
            (0, engine_js_1.resetMeasuredConsumersEngineForTest)();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Persist-Write Dateimode 0644", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-mode-"));
        try {
            await (0, persist_io_js_1.writeMeasuredConsumersPersist)(dir, {
                version: 1,
                slots: {},
                migrationsApplied: [persist_io_js_1.TAUCHPUMPE_WH_RESET_MIGRATION_ID],
            });
            const st = await fs.stat(path.join(dir, "measured_consumers_runtime_v1.json"));
            strict_1.default.equal(st.mode & 0o777, atomic_write_js_1.DIAGNOSTIC_FILE_MODE);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

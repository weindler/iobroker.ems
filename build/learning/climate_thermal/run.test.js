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
const types_1 = require("../day_telemetry/types");
const slots_1 = require("../day_telemetry/slots");
const persist_1 = require("../day_telemetry/persist");
const constants_1 = require("../day_telemetry/constants");
const math_1 = require("./math");
const run_1 = require("./run");
const persist_2 = require("./persist");
const types_2 = require("./types");
class FakeHost {
    dir;
    config = {
        timezone: "Europe/Berlin",
        ac_u1_enabled: true,
        ac_u1_mode_when_cooling: "cool",
        ac_u1_mode_when_heating: "",
        ac_u2_enabled: false,
    };
    states = new Map();
    log = { warn: () => undefined, debug: () => undefined, error: () => undefined };
    constructor(dir) {
        this.dir = dir;
    }
    getAbsolutePath = (category) => path.join(this.dir, category ?? "");
    getStateAsync = async () => null;
    setStateAsync = async (id, state) => {
        this.states.set(id, state.val);
        return null;
    };
    setObjectNotExistsAsync = async () => undefined;
    extendObjectAsync = async () => undefined;
}
(0, node_test_1.describe)("climate thermal persist / restart", () => {
    (0, node_test_1.it)("schreibt Persistenz, überlebt Restart und setzt Heating auf unavailable", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ct-run-"));
        try {
            const host = new FakeHost(dir);
            const telDir = host.getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
            const layout = (0, slots_1.buildDaySlotLayout)("2026-08-01", "Europe/Berlin");
            const day = (0, types_1.emptyDayRecord)("2026-08-01", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
            day.climateRunSegments = [
                (0, math_1.thermalTestSegment)({
                    startTs: layout.startMs + 10 * 3600_000,
                    endTs: layout.startMs + 10 * 3600_000 + 1800_000,
                    runtimeSec: 1800,
                }),
            ];
            await (0, persist_1.writeDayTelemetryDay)(telDir, day);
            const first = await (0, run_1.runClimateThermalLearning)(host, { now: new Date("2026-08-02T08:00:00Z") });
            strict_1.default.ok(first.units["1"]);
            strict_1.default.equal(first.units["1"].heating.status, "unavailable");
            strict_1.default.equal(first.units["1"].heating.rate, null);
            strict_1.default.ok(first.units["1"].cooling.sampleCount >= 1);
            strict_1.default.equal(first.units["1"].cooling.usable, false);
            const persistPath = path.join(host.getAbsolutePath("learning/climate_thermal"), types_2.CLIMATE_THERMAL_FILENAME);
            const raw = await fs.readFile(persistPath, "utf8");
            strict_1.default.ok(raw.includes("climate_thermal") || raw.includes('"version": 1'));
            const host2 = new FakeHost(dir);
            host2.config = host.config;
            const second = await (0, run_1.runClimateThermalLearning)(host2, { now: new Date("2026-08-02T09:00:00Z") });
            strict_1.default.equal(second.units["1"].cooling.sampleCount, first.units["1"].cooling.sampleCount);
            strict_1.default.equal(second.units["1"].heating.status, "unavailable");
            const reloaded = await (0, persist_2.readClimateThermalPersist)(host2.getAbsolutePath("learning/climate_thermal"));
            strict_1.default.equal(reloaded.units["1"].heating.status, "unavailable");
            strict_1.default.equal(host2.states.get("learning.climate_thermal.unit_1.heating_usable"), false);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

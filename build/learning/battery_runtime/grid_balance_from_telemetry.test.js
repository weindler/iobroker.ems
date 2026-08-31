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
const ensure_states_1 = require("../../addons/battery/ensure_states");
const constants_1 = require("../day_telemetry/constants");
const record_1 = require("../day_telemetry/record");
const persist_1 = require("../day_telemetry/persist");
const types_1 = require("../day_telemetry/types");
const slots_1 = require("../day_telemetry/slots");
const math_1 = require("./math");
const grid_balance_from_telemetry_1 = require("./grid_balance_from_telemetry");
class FakeTelHost {
    states = new Map();
    dir;
    config = { timezone: "Europe/Berlin" };
    log = { warn: () => undefined, debug: () => undefined, error: () => undefined };
    constructor(dir) {
        this.dir = dir;
    }
    getAbsolutePath = (category) => path.join(this.dir, category ?? "");
    getStateAsync = async (id) => {
        if (!this.states.has(id))
            return null;
        return { val: this.states.get(id), ack: true };
    };
    getForeignStateAsync = async (id) => this.getStateAsync(id);
    setStateAsync = async (id, state) => {
        this.states.set(id, state.val);
        return null;
    };
    set(id, val) {
        this.states.set(id, val);
    }
}
(0, node_test_1.describe)("grid balance from day telemetry", () => {
    (0, node_test_1.it)("rekonstruiert energieerhaltende Leistung aus Slot-kWh (inkl. gemessener 0)", () => {
        const layout = (0, slots_1.buildDaySlotLayout)("2026-08-30", "Europe/Berlin");
        const day = (0, types_1.emptyDayRecord)("2026-08-30", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        day.buckets.gridBalanceDischargeKwh[0] = 0.5;
        day.buckets.gridBalanceDischargeKwh[1] = 0;
        const points = (0, grid_balance_from_telemetry_1.powerPointsFromGridBalanceDay)(day);
        strict_1.default.equal(points.length, 2);
        strict_1.default.equal(points[0].powerW, (0, grid_balance_from_telemetry_1.gridBalanceKwhSlotToPowerW)(0.5, constants_1.DAY_TELEMETRY_SLOT_MS));
        strict_1.default.equal(points[1].powerW, 0);
        const hours = constants_1.DAY_TELEMETRY_SLOT_MS / 3_600_000;
        strict_1.default.ok(Math.abs((points[0].powerW * hours) / 1000 - 0.5) < 1e-9);
    });
    (0, node_test_1.it)("alte Tagesdatei ohne GB-Bucket liefert keine Punkte und erfindet keine 0", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gb-tele-"));
        try {
            const layout = (0, slots_1.buildDaySlotLayout)("2026-08-20", "Europe/Berlin");
            const day = (0, types_1.emptyDayRecord)("2026-08-20", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
            delete day.buckets.gridBalanceDischargeKwh;
            await (0, persist_1.writeDayTelemetryDay)(dir, day);
            const loaded = await (0, grid_balance_from_telemetry_1.loadGridBalancePowerFromDayTelemetry)(dir, 90, new Date("2026-08-30T12:00:00+02:00"), "Europe/Berlin");
            strict_1.default.equal(loaded.observedDayCount, 0);
            strict_1.default.equal(loaded.points.length, 0);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Tick schreibt GB-Leistung in Day-Telemetry; SOC minus gemessene GB-kWh", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gb-tick-"));
        (0, record_1.__resetDayTelemetryRuntimeForTest)();
        try {
            const host = new FakeTelHost(dir);
            host.set(ensure_states_1.BAT.gridBalance.effectivePowerW, 400);
            const t0 = new Date("2026-08-30T22:00:00+02:00");
            await (0, record_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T22:01:00+02:00");
            await (0, record_1.tickDayTelemetry)(host, t1);
            const day = await (0, persist_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            const sum = day.buckets.gridBalanceDischargeKwh.reduce((a, v) => a + (v ?? 0), 0);
            strict_1.default.ok(sum > 0, `expected GB kWh > 0, got ${sum}`);
            const points = (0, grid_balance_from_telemetry_1.powerPointsFromGridBalanceDay)(day);
            strict_1.default.ok(points.some((p) => p.powerW > 0));
            const socPoints = [
                { ts: Date.parse("2026-08-30T20:00:00+02:00"), socPct: 90 },
                { ts: Date.parse("2026-08-31T06:00:00+02:00"), socPct: 65 },
            ];
            const nightGb = [];
            for (let h = 20; h < 30; h++) {
                const ts = Date.parse("2026-08-30T00:00:00+02:00") + h * 3_600_000;
                nightGb.push({ ts, powerW: 200 });
            }
            const baseline = (0, math_1.computeNightDischarges)({
                socPoints,
                nightStart: "22:00",
                nightEnd: "06:00",
                capacityKwh: 20,
                nowMs: Date.parse("2026-08-31T12:00:00+02:00"),
            });
            const withGb = (0, math_1.computeNightDischarges)({
                socPoints,
                nightStart: "22:00",
                nightEnd: "06:00",
                capacityKwh: 20,
                gridBalancePowerPoints: nightGb,
                nowMs: Date.parse("2026-08-31T12:00:00+02:00"),
            });
            strict_1.default.ok(baseline.avgKwh !== null && withGb.avgKwh !== null);
            strict_1.default.ok(withGb.avgKwh < baseline.avgKwh);
            strict_1.default.ok(withGb.gridBalanceAttributedNights >= 1);
            strict_1.default.equal(withGb.gridBalanceExcludedNights, 0);
        }
        finally {
            (0, record_1.__resetDayTelemetryRuntimeForTest)();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

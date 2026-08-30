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
/**
 * Phase-1-Fixes: PV-Quelle, Quality/Coverage, Persistenz Tagesdateien, Snapshot-Host.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const atomic_write_js_1 = require("../../persistence/atomic_write.js");
const record_js_1 = require("./record.js");
const persist_js_1 = require("./persist.js");
const quality_mask_js_1 = require("./quality_mask.js");
const types_js_1 = require("./types.js");
const slots_js_1 = require("./slots.js");
const constants_js_1 = require("./constants.js");
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
function minimalPlan(date) {
    return {
        planId: "p1",
        generation: 1,
        date,
        timezone: "Europe/Berlin",
        allocations: [],
        reasonCodes: [],
    };
}
function minimalInput() {
    return {
        time: { timezone: "Europe/Berlin", nowIso: new Date().toISOString() },
        globalMode: "balanced",
        pv: { expectedDayEnergyKwh: 10, slots: [] },
        houseLoad: { expectedDayEnergyKwh: 8 },
        battery: { socPct: 50, usableCapacityKwh: 10, nightReserveKwh: 2 },
        prices: { slots: [] },
        climate: { units: [] },
    };
}
(0, node_test_1.describe)("day_telemetry phase1 fixes", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, record_js_1.__resetDayTelemetryRuntimeForTest)();
    });
    (0, node_test_1.it)("PV Live-Wert integriert pvKwh > 0", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pv-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("live.battery.pv_ac_power_w", 2000);
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:01:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            const sum = day.buckets.pvKwh.reduce((a, v) => a + (v ?? 0), 0);
            strict_1.default.ok(sum > 0, `expected pvKwh sum > 0, got ${sum}`);
            const anyOk = day.buckets.qualityMask.some((m) => m != null && (0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.PV) === quality_mask_js_1.DOMAIN_QUALITY.ok);
            strict_1.default.equal(anyOk, true);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("fehlender PV → quality missing, pvKwh null", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pvmiss-"));
        try {
            const host = new FakeTelHost(dir);
            /* kein PV-State */
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:01:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            const pvSum = day.buckets.pvKwh.reduce((a, v) => a + (v ?? 0), 0);
            strict_1.default.equal(pvSum, 0);
            const anyMissing = day.buckets.qualityMask.some((m) => m != null && (0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.PV) === quality_mask_js_1.DOMAIN_QUALITY.missing);
            strict_1.default.equal(anyMissing, true);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("0 W PV ist gültig (ok), nicht missing", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-pv0-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("live.battery.pv_ac_power_w", 0);
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:01:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            const anyMissing = day.buckets.qualityMask.some((m) => m != null && (0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.PV) === quality_mask_js_1.DOMAIN_QUALITY.missing);
            strict_1.default.equal(anyMissing, false);
            const anyOk = day.buckets.qualityMask.some((m) => m != null && (0, quality_mask_js_1.decodeDomainQuality)(m, quality_mask_js_1.TELEMETRY_DOMAIN.PV) === quality_mask_js_1.DOMAIN_QUALITY.ok);
            strict_1.default.equal(anyOk, true);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("unobserved Slot: qualityMask null, nicht ok", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-29", "Europe/Berlin");
        const day = (0, types_js_1.emptyDayRecord)("2026-08-29", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        strict_1.default.equal(day.buckets.qualityMask[0], null);
        (0, types_js_1.refreshDayCoverage)(day);
        strict_1.default.equal(day.observedSlotCount, 0);
        strict_1.default.equal(day.coveragePct, 0);
        strict_1.default.equal(day.evaluable, false);
        strict_1.default.equal(day.complete, false);
    });
    (0, node_test_1.it)("Teil-Tag: complete kann true sein bei niedriger Coverage", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-29", "Europe/Berlin");
        const day = (0, types_js_1.emptyDayRecord)("2026-08-29", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        /* nur wenige Slots beobachtet */
        for (let i = 70; i < 80; i++) {
            day.buckets.qualityMask[i] = 0;
        }
        day.complete = true;
        (0, types_js_1.refreshDayCoverage)(day);
        strict_1.default.equal(day.complete, true);
        strict_1.default.ok(day.coveragePct < 100);
        strict_1.default.ok(day.coveragePct < constants_js_1.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT);
        strict_1.default.equal(day.evaluable, false);
    });
    (0, node_test_1.it)("Plan-Publish persistiert Snapshot + Replan; snapshotIdRef auflösbar", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("live.battery.pv_ac_power_w", 100);
            const now = new Date("2026-08-30T12:00:00+02:00");
            await (0, record_js_1.noteDayTelemetryPlanPublished)({
                host,
                now,
                timezone: "Europe/Berlin",
                plan: minimalPlan("2026-08-30"),
                plannerInput: minimalInput(),
                replanReasons: ["replan_pv_forecast_changed"],
            });
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.ok(day.forecastSnapshots.length >= 1);
            strict_1.default.ok(day.replanEvents.length >= 1);
            const snapId = day.replanEvents[0].snapshotId;
            strict_1.default.ok(day.forecastSnapshots.some((s) => s.id === snapId));
            /* Neustart-Simulation: Runtime reset, Datei bleibt */
            (0, record_js_1.__resetDayTelemetryRuntimeForTest)();
            const day2 = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day2.forecastSnapshots.some((s) => s.id === snapId));
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Monolith-Migration → Tagesdateien, idempotent", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-mig-"));
        try {
            const layout = (0, slots_js_1.buildDaySlotLayout)("2026-08-29", "Europe/Berlin");
            const store = (0, types_js_1.emptyDayTelemetryStore)();
            store.days["2026-08-29"] = (0, types_js_1.emptyDayRecord)("2026-08-29", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
            await fs.writeFile(path.join(dir, constants_js_1.DAY_TELEMETRY_LEGACY_MONOLITH_FILE), JSON.stringify(store), "utf8");
            const r1 = await (0, persist_js_1.migrateMonolithToDayFiles)(dir);
            strict_1.default.equal(r1.migrated, true);
            strict_1.default.equal(r1.dayCount, 1);
            const day = await (0, persist_js_1.readDayTelemetryDay)(dir, "2026-08-29");
            strict_1.default.ok(day);
            const r2 = await (0, persist_js_1.migrateMonolithToDayFiles)(dir);
            strict_1.default.equal(r2.migrated, false);
            /* Monolith weg / .migrated */
            await strict_1.default.rejects(fs.access(path.join(dir, constants_js_1.DAY_TELEMETRY_LEGACY_MONOLITH_FILE)));
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("90-Tage-Retention löscht alte Tagesdateien", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ret-"));
        try {
            const store = (0, types_js_1.emptyDayTelemetryStore)();
            for (let i = 0; i < 95; i++) {
                const dk = `2026-01-${String(i + 1).padStart(2, "0")}`;
                if (i + 1 > 31)
                    break;
            }
            /* 95 Tage ab 2026-01-01 */
            const { addDaysToDateKey } = await import("../../operator/time.js");
            const start = "2026-01-01";
            for (let i = 0; i < 95; i++) {
                const dk = addDaysToDateKey(start, i);
                const layout = (0, slots_js_1.buildDaySlotLayout)(dk, "Europe/Berlin");
                store.days[dk] = (0, types_js_1.emptyDayRecord)(dk, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
            }
            await (0, persist_js_1.writeDayTelemetryPersist)(dir, store);
            const today = addDaysToDateKey(start, 94);
            const removed = await (0, persist_js_1.pruneDayTelemetryFiles)(dir, 90, today);
            strict_1.default.ok(removed.length >= 5);
            const dayPath = (0, persist_js_1.dayTelemetryDayPath)(dir, start);
            await strict_1.default.rejects(fs.access(dayPath));
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("atomisches Write → Dateimode lesbar (0644)", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-mode-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("live.battery.pv_ac_power_w", 500);
            await (0, record_js_1.tickDayTelemetry)(host, new Date("2026-08-30T11:00:00+02:00"));
            await (0, record_js_1.tickDayTelemetry)(host, new Date("2026-08-30T11:01:00+02:00"));
            const fp = (0, persist_js_1.dayTelemetryDayPath)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            const st = await fs.stat(fp);
            const mode = st.mode & 0o777;
            strict_1.default.equal(mode, atomic_write_js_1.DIAGNOSTIC_FILE_MODE);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

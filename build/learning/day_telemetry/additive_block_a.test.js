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
 * Block A — Regressionstests für additive Telemetrie-/Snapshot-Erweiterungen.
 * Ziel: neue Felder korrekt befüllt, bestehendes Verhalten (Buckets, Coverage,
 * Climate-Segmente) unverändert wenn Erweiterungen nicht genutzt werden.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const record_js_1 = require("./record.js");
const persist_js_1 = require("./persist.js");
const knowledge_snapshot_js_1 = require("./knowledge_snapshot.js");
const immersion_segments_js_1 = require("./immersion_segments.js");
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
const fresh = {
    observedAtIso: "2026-06-15T08:00:00.000Z",
    ageSec: 0,
    quality: { status: "valid", confidencePct: 100, reasonDe: "" },
};
function minimalInput(overrides = {}) {
    return {
        time: { timezone: "Europe/Berlin", nowIso: new Date().toISOString() },
        globalMode: "balanced",
        pv: { expectedDayEnergyKwh: 10, slots: [] },
        houseLoad: { expectedDayEnergyKwh: 8 },
        battery: { socPct: 50, usableCapacityKwh: 10, nightReserveKwh: 2 },
        prices: { slots: [] },
        climate: { units: [] },
        wallbox: null,
        ...overrides,
    };
}
(0, node_test_1.describe)("Block A — additive Snapshot-Erweiterungen (Wallbox/Battery)", () => {
    (0, node_test_1.it)("ohne extra-Param bleibt batteryDecision null (Rückwärtskompatibilität)", () => {
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1");
        strict_1.default.equal(snap.batteryDecision, null);
        strict_1.default.equal(snap.wallboxTargetSocPct, null);
        strict_1.default.equal(snap.wallboxManagementMode, null);
    });
    (0, node_test_1.it)("Wallbox-Zielwerte werden 1:1 aus input.wallbox gespiegelt", () => {
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput({
            wallbox: {
                targetSocPct: 80,
                minimumDepartureSocPct: 60,
                energyGoalHard: true,
                managementMode: "ems_candidate",
                deadlineIso: "2026-06-16T06:00:00.000Z",
            },
        }), "t1");
        strict_1.default.equal(snap.wallboxTargetSocPct, 80);
        strict_1.default.equal(snap.wallboxMinimumDepartureSocPct, 60);
        strict_1.default.equal(snap.wallboxEnergyGoalHard, true);
        strict_1.default.equal(snap.wallboxManagementMode, "ems_candidate");
        strict_1.default.equal(snap.wallboxDeadlineIso, "2026-06-16T06:00:00.000Z");
    });
    (0, node_test_1.it)("batteryDecision: hold_active hat Vorrang vor discharge_allowed", () => {
        const ctx = {
            dischargeAllowed: true,
            priceAllowed: true,
            socAllowed: true,
            requiredSocAtPvEndPct: 30,
            holdActive: true,
        };
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1", { batteryDecision: ctx });
        strict_1.default.deepEqual(snap.batteryDecision, {
            action: "hold",
            dischargeAllowed: true,
            requiredSocAtPvEndPct: 30,
            holdActive: true,
            reasonCode: "battery_hold_active",
        });
    });
    (0, node_test_1.it)("batteryDecision: discharge_allowed wenn Preis+Reserve ok und kein Hold", () => {
        const ctx = {
            dischargeAllowed: true,
            priceAllowed: true,
            socAllowed: true,
            requiredSocAtPvEndPct: 30,
            holdActive: false,
        };
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1", { batteryDecision: ctx });
        strict_1.default.equal(snap.batteryDecision?.action, "discharge_allowed");
        strict_1.default.equal(snap.batteryDecision?.reasonCode, "price_and_reserve_ok");
    });
    (0, node_test_1.it)("batteryDecision: reserve_unknown wenn requiredSocAtPvEndPct null", () => {
        const ctx = {
            dischargeAllowed: false,
            priceAllowed: true,
            socAllowed: false,
            requiredSocAtPvEndPct: null,
            holdActive: false,
        };
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1", { batteryDecision: ctx });
        strict_1.default.equal(snap.batteryDecision?.action, "discharge_blocked");
        strict_1.default.equal(snap.batteryDecision?.reasonCode, "reserve_unknown");
    });
    (0, node_test_1.it)("batteryDecision: price_blocked wenn Preis nicht erlaubt, Reserve bekannt", () => {
        const ctx = {
            dischargeAllowed: false,
            priceAllowed: false,
            socAllowed: true,
            requiredSocAtPvEndPct: 30,
            holdActive: false,
        };
        const snap = (0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1", { batteryDecision: ctx });
        strict_1.default.equal(snap.batteryDecision?.reasonCode, "price_blocked");
    });
    (0, node_test_1.it)("Snapshot-Hash ändert sich bei neuem batteryDecision-Kontext (kein Dedup-Fehlschluss)", () => {
        const withoutCtx = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t1"));
        const withCtx = (0, knowledge_snapshot_js_1.withSnapshotId)((0, knowledge_snapshot_js_1.buildPlannerKnowledgeSnapshot)(minimalInput(), "t2", {
            batteryDecision: {
                dischargeAllowed: true,
                priceAllowed: true,
                socAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
            },
        }));
        strict_1.default.notEqual(withoutCtx.id, withCtx.id);
    });
});
(0, node_test_1.describe)("Block A — immersion_segments (reine Funktionen)", () => {
    (0, node_test_1.it)("on→off schließt Segment mit Kontext aus Startzeitpunkt", () => {
        const ctx = {
            decisionSource: "daily_plan",
            forcedMode: false,
            hygieneStatusDe: "Hygiene erfüllt.",
            ownershipOwner: "ems",
        };
        const t0 = 1000;
        const opened = (0, immersion_segments_js_1.advanceImmersionSegment)(null, t0, true, 0.1, 60, ctx, []);
        strict_1.default.ok(opened.open);
        /* Kontextänderung während des Laufs darf Start-Kontext nicht überschreiben */
        const advanced = (0, immersion_segments_js_1.advanceImmersionSegment)(opened.open, t0 + 60_000, true, 0.1, 60, { ...ctx, forcedMode: true }, opened.list);
        strict_1.default.equal(advanced.open?.forcedMode, false);
        const closed = (0, immersion_segments_js_1.advanceImmersionSegment)(advanced.open, t0 + 120_000, false, 0, 0, ctx, advanced.list);
        strict_1.default.equal(closed.open, null);
        strict_1.default.equal(closed.list.length, 1);
        strict_1.default.equal(closed.list[0].decisionSource, "daily_plan");
        strict_1.default.equal(closed.list[0].forcedMode, false);
        strict_1.default.equal(closed.list[0].runtimeSec, 120);
    });
    (0, node_test_1.it)("Segment mit 0 Laufzeit wird nicht persistiert (closeImmersionSegment)", () => {
        const list = (0, immersion_segments_js_1.closeImmersionSegment)({ startTs: 5000, energyKwh: 0, runtimeSec: 0, decisionSource: null, forcedMode: null, hygieneStatusDe: null, ownershipOwner: null }, 5000, []);
        strict_1.default.equal(list.length, 0);
    });
});
(0, node_test_1.describe)("Block A — immersionRunSegments im echten Tick (Live-Mirror, kein Recompute)", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, record_js_1.__resetDayTelemetryRuntimeForTest)();
    });
    (0, node_test_1.it)("Heizstab-Lauf erzeugt Segment mit gespiegeltem decisionSource/resolvedMode", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-seg-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("addons.immersion_heater.runtime.measured_power_w", 2000);
            host.set("addons.immersion_heater.runtime.commanded_power_w", 2000);
            host.set("addons.immersion_heater.runtime.decision_source", "daily_plan");
            host.set("addons.immersion_heater.runtime.resolved_mode", "auto");
            host.set("addons.immersion_heater.runtime.hygiene_status_de", "Hygiene erfüllt.");
            host.set("addons.immersion_heater.runtime.ownership_owner", "ems");
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:05:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            /* Lauf endet */
            host.set("addons.immersion_heater.runtime.measured_power_w", 0);
            host.set("addons.immersion_heater.runtime.commanded_power_w", 0);
            const t2 = new Date("2026-08-30T10:10:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t2);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.ok(day.immersionRunSegments.length >= 1);
            const seg = day.immersionRunSegments[0];
            strict_1.default.equal(seg.decisionSource, "daily_plan");
            strict_1.default.equal(seg.forcedMode, false);
            strict_1.default.equal(seg.hygieneStatusDe, "Hygiene erfüllt.");
            strict_1.default.equal(seg.ownershipOwner, "ems");
            strict_1.default.ok(seg.runtimeSec > 0);
            strict_1.default.ok(seg.energyKwh > 0);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Force-Modus wird als forcedMode=true gespiegelt", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-force-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("addons.immersion_heater.runtime.measured_power_w", 2000);
            host.set("addons.immersion_heater.runtime.commanded_power_w", 2000);
            host.set("addons.immersion_heater.runtime.resolved_mode", "force");
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:05:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            host.set("addons.immersion_heater.runtime.measured_power_w", 0);
            host.set("addons.immersion_heater.runtime.commanded_power_w", 0);
            const t2 = new Date("2026-08-30T10:10:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t2);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.ok(day.immersionRunSegments.length >= 1);
            strict_1.default.equal(day.immersionRunSegments[0].forcedMode, true);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("kein Heizstab-Lauf → keine Segmente, bestehende Buckets bleiben unverändert (Regression)", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-ih-none-"));
        try {
            const host = new FakeTelHost(dir);
            host.set("live.battery.pv_ac_power_w", 1000);
            const t0 = new Date("2026-08-30T10:00:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t0);
            const t1 = new Date("2026-08-30T10:05:00+02:00");
            await (0, record_js_1.tickDayTelemetry)(host, t1);
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.equal(day.immersionRunSegments.length, 0);
            const pvSum = day.buckets.pvKwh.reduce((a, v) => a + (v ?? 0), 0);
            strict_1.default.ok(pvSum > 0);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Plan-Publish mit batteryDecision-Kontext: Snapshot enthält batteryDecision, bestehende Felder unverändert", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-bd-"));
        try {
            const host = new FakeTelHost(dir);
            const now = new Date("2026-08-30T12:00:00+02:00");
            await (0, record_js_1.noteDayTelemetryPlanPublished)({
                host,
                now,
                timezone: "Europe/Berlin",
                plan: minimalPlan("2026-08-30"),
                plannerInput: minimalInput(),
                replanReasons: ["replan_pv_forecast_changed"],
                batteryDecision: {
                    dischargeAllowed: true,
                    priceAllowed: true,
                    socAllowed: true,
                    requiredSocAtPvEndPct: 25,
                    holdActive: false,
                },
            });
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.equal(day.forecastSnapshots.length, 1);
            const snap = day.forecastSnapshots[0];
            strict_1.default.equal(snap.batteryDecision?.action, "discharge_allowed");
            strict_1.default.equal(snap.batteryDecision?.requiredSocAtPvEndPct, 25);
            /* bestehende Felder unverändert befüllt */
            strict_1.default.equal(snap.batterySocPct, 50);
            strict_1.default.equal(snap.globalMode, "balanced");
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Plan-Publish ohne batteryDecision-Kontext (Altverhalten): Snapshot.batteryDecision = null", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dt-snap-nobd-"));
        try {
            const host = new FakeTelHost(dir);
            const now = new Date("2026-08-30T12:00:00+02:00");
            await (0, record_js_1.noteDayTelemetryPlanPublished)({
                host,
                now,
                timezone: "Europe/Berlin",
                plan: minimalPlan("2026-08-30"),
                plannerInput: minimalInput(),
                replanReasons: [],
            });
            const day = await (0, persist_js_1.readDayTelemetryDay)(path.join(dir, "learning/day_telemetry"), "2026-08-30");
            strict_1.default.ok(day);
            strict_1.default.equal(day.forecastSnapshots[0].batteryDecision, null);
        }
        finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

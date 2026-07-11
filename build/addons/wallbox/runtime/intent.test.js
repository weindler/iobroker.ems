"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contribution_ids_1 = require("../../../operator/contribution_ids");
const contributor_1 = require("../../../operator/contributor");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const daily_plan_js_1 = require("./daily_plan.js");
const intent_js_1 = require("./intent.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
const DEADLINE = "2026-07-11T14:00:00.000Z";
function telemetry(over = {}) {
    return {
        connected: true,
        charging: false,
        vehicleSocPct: 40,
        planSocPct: 80,
        planActive: true,
        sessionEnergyKwh: 5,
        effectivePlanTime: DEADLINE,
        planTime: DEADLINE,
        activePhases: 1,
        configuredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        chargePowerW: null,
        evccConfigured: true,
        mappingsReady: true,
        ...over,
    };
}
function allocationEntry(allocatedPowerW, status = "allocated") {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status,
        energySource: "grid",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
        gridPowerW: allocatedPowerW ?? 0,
        pvPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: DEADLINE,
        estimatedCostCt: 12,
        reasonDe: "test",
    };
}
function decision(entries, tel = telemetry(), over = {}) {
    return (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: TZ,
        meta: { status: "ready", date: "2026-07-11", revision: 7, validUntil: null, timezone: TZ },
        entries,
        telemetry: tel,
        governanceEnabled: true,
        addonEnabled: true,
        ...over,
    });
}
function intentFrom(entries, tel = telemetry(), opts = {}) {
    const d = decision(entries, tel, {
        governanceEnabled: opts.governanceEnabled ?? true,
        addonEnabled: opts.addonEnabled ?? true,
        meta: opts.meta ?? { status: "ready", date: "2026-07-11", revision: 7, validUntil: null, timezone: TZ },
    });
    return (0, intent_js_1.buildWallboxDispatchIntent)({
        decision: d,
        governanceEnabled: opts.governanceEnabled ?? true,
        addonEnabled: opts.addonEnabled ?? true,
        phases: tel.activePhases ?? tel.configuredPhases,
        now: NOW,
    });
}
(0, node_test_1.describe)("wallbox dispatch intent", () => {
    (0, node_test_1.it)("disconnected produces none", () => {
        const i = intentFrom([allocationEntry(3600)], telemetry({ connected: false, vehicleSocPct: 0 }));
        strict_1.default.equal(i.action, "none");
        strict_1.default.equal(i.enabled, false);
        strict_1.default.equal(i.targetPowerW, 0);
        strict_1.default.equal(i.targetCurrentA, null);
    });
    (0, node_test_1.it)("connected with positive allocation produces charge", () => {
        const i = intentFrom([allocationEntry(3600)]);
        strict_1.default.equal(i.action, "charge");
        strict_1.default.equal(i.enabled, true);
        strict_1.default.equal(i.targetPowerW, 3600);
        strict_1.default.equal(i.dailyPlanRevision, 7);
        strict_1.default.ok(i.validUntil);
    });
    (0, node_test_1.it)("valid zero allocation produces hold", () => {
        const i = intentFrom([]);
        strict_1.default.equal(i.action, "hold");
        strict_1.default.equal(i.enabled, false);
        strict_1.default.equal(i.targetPowerW, 0);
    });
    (0, node_test_1.it)("missing plan produces none", () => {
        const i = intentFrom([], telemetry(), {
            meta: { status: "not_initialized", date: "2026-07-11", revision: 0, validUntil: null, timezone: TZ },
        });
        strict_1.default.equal(i.action, "none");
        strict_1.default.equal(i.enabled, false);
    });
    (0, node_test_1.it)("invalid plan produces none", () => {
        const i = intentFrom([allocationEntry(3600), allocationEntry(1800)]);
        strict_1.default.equal(i.action, "none");
    });
    (0, node_test_1.it)("governance off produces none", () => {
        const i = intentFrom([allocationEntry(3600)], telemetry(), { governanceEnabled: false });
        strict_1.default.equal(i.action, "none");
    });
    (0, node_test_1.it)("addon disabled produces none", () => {
        const i = intentFrom([allocationEntry(3600)], telemetry(), { addonEnabled: false });
        strict_1.default.equal(i.action, "none");
    });
    (0, node_test_1.it)("mapping incomplete produces none", () => {
        const i = intentFrom([allocationEntry(3600)], telemetry({ mappingsReady: false }));
        strict_1.default.equal(i.action, "none");
    });
    (0, node_test_1.it)("pv source is mapped", () => {
        const entry = allocationEntry(3600);
        entry.energySource = "pv_surplus";
        const i = intentFrom([entry]);
        strict_1.default.equal(i.source, "pv_surplus");
        strict_1.default.match(i.reasonDe, /PV/);
    });
    (0, node_test_1.it)("below min power allocation produces hold", () => {
        const i = intentFrom([allocationEntry(800)], telemetry({ activePhases: 1, minCurrentA: 6 }));
        strict_1.default.equal(i.action, "hold");
        strict_1.default.match(i.reasonDe, /Mindestladeleistung/);
    });
});

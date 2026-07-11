"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const contribution_ids_1 = require("../../../operator/contribution_ids");
const contributor_1 = require("../../../operator/contributor");
const slots_1 = require("../../../operator/daily_plan/slots");
const time_1 = require("../../../operator/time");
const daily_plan_js_1 = require("./daily_plan.js");
const intent_js_1 = require("./intent.js");
const dispatch_js_1 = require("./dispatch.js");
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
        planActive: false,
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
function allocationEntry(allocatedPowerW, energySource = "grid") {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
        contributor: (0, contributor_1.addonContributorRef)("wallbox"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status: "allocated",
        energySource,
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: allocatedPowerW !== null ? (allocatedPowerW * 0.25) / 1000 : null,
        gridPowerW: energySource === "pv_surplus" ? 0 : (allocatedPowerW ?? 0),
        pvPowerW: energySource === "pv_surplus" ? (allocatedPowerW ?? 0) : 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: DEADLINE,
        estimatedCostCt: 12,
        reasonDe: "test",
    };
}
function planDecision(entries, tel = telemetry()) {
    return (0, daily_plan_js_1.evaluateWallboxDailyPlan)({
        now: NOW,
        timezone: TZ,
        meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
        entries,
        telemetry: tel,
        governanceEnabled: true,
        addonEnabled: true,
        vehicleCapacityKwh: 60,
    });
}
function dryrun(entries, tel = telemetry(), config = {}) {
    const decision = planDecision(entries, tel);
    const intent = (0, intent_js_1.buildWallboxDispatchIntent)({
        decision,
        governanceEnabled: true,
        addonEnabled: true,
        phases: tel.activePhases ?? tel.configuredPhases,
        now: NOW,
    });
    return (0, dispatch_js_1.runWallboxDryrunDispatch)({
        intent,
        decision,
        telemetry: tel,
        config,
        chargingEnabled: false,
        governanceEnabled: true,
    });
}
(0, node_test_1.describe)("wallbox power to current", () => {
    (0, node_test_1.it)("single phase conversion", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(1380, 1, 6, 16);
        strict_1.default.equal(r.currentA, 6);
    });
    (0, node_test_1.it)("three phase conversion uses active phases", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(4140, 3, 6, 16);
        strict_1.default.equal(r.currentA, 6);
    });
    (0, node_test_1.it)("below minimum current returns null", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(500, 1, 6, 16);
        strict_1.default.equal(r.currentA, null);
    });
    (0, node_test_1.it)("exact minimum power", () => {
        const minW = 1 * dispatch_js_1.WALLBOX_AC_VOLTAGE_V * 6;
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(minW, 1, 6, 16);
        strict_1.default.equal(r.currentA, 6);
    });
    (0, node_test_1.it)("caps at maximum current", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(10000, 1, 6, 16);
        strict_1.default.equal(r.currentA, 16);
    });
    (0, node_test_1.it)("missing phases returns null", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(3600, null, 6, 16);
        strict_1.default.equal(r.currentA, null);
    });
    (0, node_test_1.it)("integer amp steps", () => {
        const r = (0, dispatch_js_1.powerToTargetCurrentA)(1500, 1, 6, 16);
        strict_1.default.equal(r.currentA, 7);
    });
});
(0, node_test_1.describe)("wallbox dispatch readiness", () => {
    (0, node_test_1.it)("complete legacy mapping", () => {
        const r = (0, dispatch_js_1.evaluateWallboxDispatchReadiness)({
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.ampere",
        });
        strict_1.default.equal(r.controlMappingComplete, true);
        strict_1.default.equal(r.enableMappingAvailable, true);
        strict_1.default.equal(r.currentMappingAvailable, true);
        strict_1.default.equal(r.liveDispatchSupported, false);
    });
    (0, node_test_1.it)("enable missing", () => {
        const r = (0, dispatch_js_1.evaluateWallboxDispatchReadiness)({ wb_set_current_a_target: "go-e.0.ampere" });
        strict_1.default.equal(r.enableMappingAvailable, false);
        strict_1.default.equal(r.controlMappingComplete, false);
        strict_1.default.ok(r.missingMappings.includes("set_enabled"));
    });
    (0, node_test_1.it)("current missing without power alternative", () => {
        const r = (0, dispatch_js_1.evaluateWallboxDispatchReadiness)({ wb_set_enabled_target: "go-e.0.allow_charging" });
        strict_1.default.equal(r.currentMappingAvailable, false);
        strict_1.default.equal(r.powerMappingAvailable, false);
        strict_1.default.ok(r.missingMappings.some((m) => m.includes("set_current")));
    });
    (0, node_test_1.it)("power mapping as alternative", () => {
        const r = (0, dispatch_js_1.evaluateWallboxDispatchReadiness)({
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_charge_power_w_target: "go-e.0.power",
        });
        strict_1.default.equal(r.powerMappingAvailable, true);
        strict_1.default.equal(r.controlMappingComplete, true);
    });
    (0, node_test_1.it)("live dispatch always false in v0.1.133", () => {
        const r = (0, dispatch_js_1.evaluateWallboxDispatchReadiness)({
            wb_set_enabled_target: "x",
            wb_set_current_a_target: "y",
        });
        strict_1.default.equal(r.liveDispatchSupported, false);
        strict_1.default.equal(r.modeMappingAvailable, false);
    });
});
(0, node_test_1.describe)("wallbox dryrun dispatch", () => {
    (0, node_test_1.beforeEach)(() => (0, dispatch_js_1.resetWallboxDispatchCache)());
    (0, node_test_1.it)("charge produces target current and dryrun command", () => {
        const r = dryrun([allocationEntry(3600)]);
        strict_1.default.equal(r.dispatchStatus, "charge_planned");
        strict_1.default.equal(r.target.action, "charge");
        strict_1.default.equal(r.target.enableCharging, true);
        strict_1.default.equal(r.target.targetPowerW, 3600);
        strict_1.default.equal(r.target.targetCurrentA, 16);
        strict_1.default.equal(r.target.desiredEvccMode, null);
        strict_1.default.match(r.dispatchReasonDe, /Dryrun-Ziel/);
        strict_1.default.match(r.dispatchReasonDe, /kein EVCC-Kommando/);
        strict_1.default.ok(r.dryrunCommand.some((c) => c.role === "set_current_a"));
    });
    (0, node_test_1.it)("caps power at technical maximum", () => {
        const tel = telemetry({ activePhases: 1, minCurrentA: 6, maxCurrentA: 10 });
        const r = dryrun([allocationEntry(10000)], tel);
        strict_1.default.equal(r.target.targetPowerW, 2300);
        strict_1.default.equal(r.target.targetCurrentA, 10);
    });
    (0, node_test_1.it)("missing phases yields hold at plan level", () => {
        const r = dryrun([allocationEntry(3600)], telemetry({ activePhases: null, configuredPhases: null }));
        strict_1.default.equal(r.dispatchStatus, "hold");
        strict_1.default.equal(r.intent.action, "hold");
    });
    (0, node_test_1.it)("deadline at risk still allows charge", () => {
        const entry = allocationEntry(3600);
        const decision = planDecision([entry]);
        decision.deadlineReachable = false;
        const intent = (0, intent_js_1.buildWallboxDispatchIntent)({
            decision,
            governanceEnabled: true,
            addonEnabled: true,
            phases: 1,
            now: NOW,
        });
        const r = (0, dispatch_js_1.runWallboxDryrunDispatch)({
            intent,
            decision,
            telemetry: telemetry(),
            config: {},
            chargingEnabled: false,
            governanceEnabled: true,
        });
        strict_1.default.equal(r.deadlineStatus, "at_risk");
        strict_1.default.equal(r.target.action, "charge");
        strict_1.default.match(r.target.reasonDe, /Deadline/);
    });
    (0, node_test_1.it)("disconnected produces none and empty dryrun command", () => {
        const r = dryrun([allocationEntry(3600)], telemetry({ connected: false }));
        strict_1.default.equal(r.dispatchStatus, "none");
        strict_1.default.equal(r.dryrunCommand.length, 0);
    });
    (0, node_test_1.it)("hold produces dryrun disable intent", () => {
        const r = dryrun([]);
        strict_1.default.equal(r.dispatchStatus, "hold");
        strict_1.default.equal(r.target.enableCharging, false);
    });
    (0, node_test_1.it)("cache returns same result without recalculation", () => {
        const first = dryrun([allocationEntry(3600)]);
        const second = dryrun([allocationEntry(3600)]);
        strict_1.default.equal(first, second);
    });
    (0, node_test_1.it)("cache resets on revision change", () => {
        const first = dryrun([allocationEntry(3600)]);
        (0, dispatch_js_1.resetWallboxDispatchCache)();
        const decision = planDecision([allocationEntry(3600)]);
        decision.dailyPlanRevision = 99;
        const intent = (0, intent_js_1.buildWallboxDispatchIntent)({
            decision,
            governanceEnabled: true,
            addonEnabled: true,
            phases: 1,
            now: NOW,
        });
        const second = (0, dispatch_js_1.runWallboxDryrunDispatch)({
            intent,
            decision,
            telemetry: telemetry(),
            config: {},
            chargingEnabled: false,
            governanceEnabled: true,
        });
        strict_1.default.notEqual(first.intent.dailyPlanRevision, second.intent.dailyPlanRevision);
    });
    (0, node_test_1.it)("mixed source is preserved", () => {
        const r = dryrun([allocationEntry(3600, "mixed")]);
        strict_1.default.equal(r.target.source, "mixed");
    });
    (0, node_test_1.it)("dispatch source has no failsafe or foreign write imports", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/runtime/dispatch.ts"), "utf8");
        strict_1.default.ok(!src.includes("failsafe"));
        strict_1.default.ok(!src.includes("writeForeignIfChanged"));
        strict_1.default.ok(!src.includes("setForeignState"));
        const r = dryrun([allocationEntry(3600)], telemetry(), {
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.ampere",
        });
        strict_1.default.equal(r.readiness.controlMappingComplete, true);
        strict_1.default.equal(r.readiness.liveDispatchSupported, false);
    });
});

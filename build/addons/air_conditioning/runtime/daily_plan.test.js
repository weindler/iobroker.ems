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
const config_js_1 = require("../config.js");
const fsm_js_1 = require("./fsm.js");
const daily_plan_js_1 = require("./daily_plan.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = "2026-07-11T10:15:00.000Z";
const UNIT = (0, config_js_1.acUnitConfigFromAdapter)({
    ac_u1_enabled: true,
    ac_u1_estimated_power_w: 800,
    ac_u1_on_temp_c: 24.5,
    ac_u1_off_temp_c: 23,
    ac_u1_active_from: "08:00",
    ac_u1_active_until: "19:00",
    ac_u1_hard_off_at: "19:00",
}, 1);
function allocationEntry(unitIndex, allocatedPowerW, status = "allocated") {
    const contributionId = (0, contribution_ids_1.acUnitContributionId)(unitIndex);
    return {
        contributionId,
        contributor: (0, contributor_1.addonContributorRef)("air_conditioning"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status,
        energySource: "grid",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        gridPowerW: allocatedPowerW ?? 0,
        pvPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "test",
    };
}
function fsmDemandStart() {
    return (0, fsm_js_1.evaluateAcUnitFsm)({
        now: NOW,
        addonEnabled: true,
        unit: UNIT,
        roomTempC: 26,
        roomHumidityPct: 50,
        feedbackSwitchRaw: "off",
        cleaningActive: false,
    });
}
(0, node_test_1.describe)("ac daily plan reader", () => {
    (0, node_test_1.it)("parses valid allocation JSON", () => {
        const parsed = (0, daily_plan_js_1.parseDailyAllocationEntries)(JSON.stringify([allocationEntry(1, 800)]));
        strict_1.default.ok(parsed);
        strict_1.default.equal(parsed.length, 1);
    });
    (0, node_test_1.it)("merges unit slot allocation", () => {
        const merge = (0, daily_plan_js_1.mergeUnitSlotAllocation)([allocationEntry(1, 900)], (0, contribution_ids_1.acUnitContributionId)(1), SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, true);
        strict_1.default.equal(merge.allocatedPowerW, 900);
    });
    (0, node_test_1.it)("detects duplicate allocation", () => {
        const merge = (0, daily_plan_js_1.mergeUnitSlotAllocation)([allocationEntry(1, 500), allocationEntry(1, 500)], (0, contribution_ids_1.acUnitContributionId)(1), SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, false);
    });
    (0, node_test_1.it)("separates units 1 and 2", () => {
        const entries = [allocationEntry(1, 700), allocationEntry(2, 600)];
        const u1 = (0, daily_plan_js_1.mergeUnitSlotAllocation)(entries, (0, contribution_ids_1.acUnitContributionId)(1), SLOT_START, SLOT_END);
        const u2 = (0, daily_plan_js_1.mergeUnitSlotAllocation)(entries, (0, contribution_ids_1.acUnitContributionId)(2), SLOT_START, SLOT_END);
        strict_1.default.equal(u1.allocatedPowerW, 700);
        strict_1.default.equal(u2.allocatedPowerW, 600);
    });
    (0, node_test_1.it)("resolves valid allocation", () => {
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const r = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 2, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 800)],
            expectedPower: expected,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.allocationAllowsStart, true);
        strict_1.default.equal(r.allocatedPowerW, 800);
    });
    (0, node_test_1.it)("valid zero allocation without fallback", () => {
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const r = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [],
            expectedPower: expected,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.equal(r.allocationAllowsStart, false);
    });
    (0, node_test_1.it)("blocks start when allocation below expected power", () => {
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const r = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 500)],
            expectedPower: expected,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.allocationAllowsStart, false);
        strict_1.default.equal(r.dailyPlanStatus, "allocation_below_expected_power");
    });
    (0, node_test_1.it)("falls back on wrong date", () => {
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const r = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 800)],
            expectedPower: expected,
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.match(r.allocationReasonDe, /Klima-Fallback/);
    });
    (0, node_test_1.it)("uses configured power when stats missing", () => {
        const p = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        strict_1.default.equal(p.source, "config");
        strict_1.default.equal(p.powerW, 800);
        strict_1.default.equal(p.valid, true);
    });
});
(0, node_test_1.describe)("ac cooling permission", () => {
    (0, node_test_1.it)("governance disabled blocks start", () => {
        const fsm = fsmDemandStart();
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const dailyPlan = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 800)],
            expectedPower: expected,
        });
        const perm = (0, daily_plan_js_1.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: false,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            startRetryReady: true,
            stopRetryReady: true,
        });
        strict_1.default.equal(perm.decisionSource, "governance_disabled");
        strict_1.default.equal(perm.allowStart, false);
        strict_1.default.equal(perm.deviceWritesAllowed, false);
    });
    (0, node_test_1.it)("daily plan allows start with thermal demand", () => {
        const fsm = fsmDemandStart();
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const dailyPlan = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 800)],
            expectedPower: expected,
        });
        const perm = (0, daily_plan_js_1.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            startRetryReady: true,
            stopRetryReady: true,
        });
        strict_1.default.equal(perm.allowStart, true);
        strict_1.default.equal(perm.decisionSource, "daily_plan");
    });
    (0, node_test_1.it)("no fallback on valid zero allocation", () => {
        const fsm = fsmDemandStart();
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const dailyPlan = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [],
            expectedPower: expected,
        });
        const perm = (0, daily_plan_js_1.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            startRetryReady: true,
            stopRetryReady: true,
        });
        strict_1.default.equal(perm.allowStart, false);
        strict_1.default.equal(perm.decisionSource, "daily_plan");
    });
    (0, node_test_1.it)("climate fallback when plan missing", () => {
        const fsm = fsmDemandStart();
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const dailyPlan = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "not_initialized", date: "", revision: 0, validUntil: null, timezone: TZ },
            entries: [],
            expectedPower: expected,
        });
        strict_1.default.equal(dailyPlan.useDailyPlan, false);
        const perm = (0, daily_plan_js_1.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            startRetryReady: true,
            stopRetryReady: true,
        });
        strict_1.default.equal(perm.allowStart, true);
        strict_1.default.equal(perm.decisionSource, "climate_fallback");
    });
    (0, node_test_1.it)("temperature no demand with positive allocation", () => {
        const fsm = (0, fsm_js_1.evaluateAcUnitFsm)({
            now: NOW,
            addonEnabled: true,
            unit: UNIT,
            roomTempC: 23.5,
            roomHumidityPct: 50,
            feedbackSwitchRaw: "off",
            cleaningActive: false,
        });
        const expected = (0, daily_plan_js_1.resolveUnitExpectedPower)(UNIT, undefined, NOW.getTime());
        const dailyPlan = (0, daily_plan_js_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(1, 800)],
            expectedPower: expected,
        });
        const perm = (0, daily_plan_js_1.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            fsm,
            dailyPlan,
            startRetryReady: true,
            stopRetryReady: true,
        });
        strict_1.default.equal(perm.decisionSource, "temperature_no_demand");
        strict_1.default.equal(perm.allowStart, false);
    });
    (0, node_test_1.it)("resets cache helper", () => {
        (0, daily_plan_js_1.resetAcDailyPlanCache)();
        strict_1.default.ok(true);
    });
});

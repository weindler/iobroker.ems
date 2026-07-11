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
const registry_js_1 = require("../profiles/registry.js");
const daily_plan_js_1 = require("./daily_plan.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = (0, time_1.isoFromMs)(Date.parse(SLOT_START) + slots_1.DAILY_PLAN_SLOT_MS);
const PROFILE = (0, registry_js_1.getBatteryProfile)("sonnen_em");
const LIMITS = {
    maxChargeW: 5000,
    maxDischargeW: 5000,
    minSocPct: 5,
    maxSocPct: 100,
    valid: true,
    issues: [],
};
function allocationEntry(allocatedPowerW, status = "allocated", over = {}) {
    return {
        contributionId: contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE,
        contributor: (0, contributor_1.addonContributorRef)("battery"),
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
        ...over,
    };
}
function resolve(entries, over = {}) {
    return (0, daily_plan_js_1.resolveBatteryDailyPlanFromData)({
        now: NOW,
        timezone: TZ,
        meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
        entries,
        dischargePresent: false,
        profile: PROFILE,
        limits: LIMITS,
        socPct: 50,
        topOffActive: false,
        targetSocFromIntent: null,
        governanceEnabled: true,
        ...over,
    });
}
(0, node_test_1.describe)("battery daily plan reader", () => {
    (0, node_test_1.beforeEach)(() => (0, daily_plan_js_1.resetBatteryDailyPlanCache)());
    (0, node_test_1.it)("parses valid allocation JSON", () => {
        const parsed = (0, daily_plan_js_1.parseDailyAllocationEntries)(JSON.stringify([allocationEntry(3000)]));
        strict_1.default.ok(parsed);
        strict_1.default.equal(parsed.length, 1);
    });
    (0, node_test_1.it)("rejects invalid JSON", () => {
        strict_1.default.equal((0, daily_plan_js_1.parseDailyAllocationEntries)("{bad"), null);
    });
    (0, node_test_1.it)("detects duplicate allocation", () => {
        const merge = (0, daily_plan_js_1.mergeBatteryChargeSlotAllocation)([allocationEntry(2000), allocationEntry(1000)], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, false);
    });
    (0, node_test_1.it)("ignores battery.discharge entries", () => {
        const discharge = allocationEntry(1000);
        discharge.contributionId = contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE;
        const r = resolve([discharge, allocationEntry(0, "unallocated")], { dischargePresent: true });
        strict_1.default.equal(r.dailyPlanAuthoritative, true);
        strict_1.default.equal(r.chargingAllowed, false);
        strict_1.default.equal(r.dischargeIgnored, true);
    });
    (0, node_test_1.it)("rejects negative power", () => {
        const r = resolve([allocationEntry(-500)]);
        strict_1.default.equal(r.chargingAllowed, false);
        strict_1.default.equal(r.dailyPlanAuthoritative, true);
    });
    (0, node_test_1.it)("valid zero allocation is authoritative without fallback", () => {
        const r = resolve([]);
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanAuthoritative, true);
        strict_1.default.equal(r.chargingAllowed, false);
        strict_1.default.equal(r.legacyFallbackActive, false);
        strict_1.default.equal(r.dailyPlanBlocksGridBalance, true);
        strict_1.default.equal((0, daily_plan_js_1.isBatteryDailyPlanAuthoritative)(r), true);
    });
    (0, node_test_1.it)("unallocated status yields no charge", () => {
        const r = resolve([allocationEntry(3000, "unallocated")]);
        strict_1.default.equal(r.chargingAllowed, false);
        strict_1.default.equal(r.dailyPlanAuthoritative, true);
    });
    (0, node_test_1.it)("allows allocated charge within limits", () => {
        const r = resolve([allocationEntry(3000)]);
        strict_1.default.equal(r.chargingAllowed, true);
        strict_1.default.equal(r.effectiveChargePowerW, 3000);
        strict_1.default.equal(r.decisionSource, "daily_plan");
    });
    (0, node_test_1.it)("caps allocation above hardware max", () => {
        const r = resolve([allocationEntry(8000)]);
        strict_1.default.equal(r.effectiveChargePowerW, 5000);
        strict_1.default.equal(r.chargePowerCapped, true);
    });
    (0, node_test_1.it)("falls back on wrong date", () => {
        const r = resolve([allocationEntry(3000)], {
            meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.equal(r.legacyFallbackActive, true);
    });
    (0, node_test_1.it)("blocks charge at target soc", () => {
        const r = resolve([allocationEntry(3000)], { socPct: 95, targetSocFromIntent: 90 });
        strict_1.default.equal(r.dailyPlanStatus, "soc_at_target");
        strict_1.default.equal(r.chargingAllowed, false);
    });
    (0, node_test_1.it)("maps device intent for grid allocation", () => {
        const ctx = resolve([allocationEntry(2500, "allocated", { energySource: "grid", gridPowerW: 2500 })]);
        const intent = (0, daily_plan_js_1.deviceIntentFromDailyPlan)(ctx, NOW.getTime());
        strict_1.default.equal(intent.action, "grid_charge");
        strict_1.default.equal(intent.maxChargeW, 2500);
        strict_1.default.equal(intent.source, "daily_plan");
    });
    (0, node_test_1.it)("maps zero allocation to self_consumption intent", () => {
        const ctx = resolve([]);
        const intent = (0, daily_plan_js_1.deviceIntentFromDailyPlan)(ctx, NOW.getTime());
        strict_1.default.equal(intent.action, "self_consumption");
        strict_1.default.equal(intent.maxChargeW, 0);
    });
});
(0, node_test_1.describe)("battery daily plan priority signals", () => {
    (0, node_test_1.it)("authoritative plan blocks legacy fallback flag", () => {
        const r = resolve([allocationEntry(0)]);
        strict_1.default.equal(r.legacyFallbackActive, false);
        strict_1.default.equal(r.dailyPlanBlocksGridBalance, true);
    });
    (0, node_test_1.it)("invalid plan enables legacy fallback", () => {
        const r = resolve([allocationEntry(3000)], {
            meta: { status: "error", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.equal(r.legacyFallbackActive, true);
    });
});

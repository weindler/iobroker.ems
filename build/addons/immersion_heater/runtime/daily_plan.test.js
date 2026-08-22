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
const device_config_js_1 = require("../device_config.js");
const daily_plan_js_1 = require("./daily_plan.js");
const live_surplus_hold_js_1 = require("./live_surplus_hold.js");
const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = (0, slots_1.slotStartIsoFloored)(NOW, TZ);
const SLOT_END = "2026-07-11T10:15:00.000Z";
const MULTI_STAGE_CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_stage_count: 3,
    ih_stage_1_nominal_power_w: 1700,
    ih_stage_2_nominal_power_w: 3400,
    ih_stage_3_nominal_power_w: 5100,
    ih_stage_1_set_state: "s1",
    ih_stage_2_set_state: "s2",
    ih_stage_3_set_state: "s3",
    ih_stage_1_enabled: true,
    ih_stage_2_enabled: true,
    ih_stage_3_enabled: true,
});
function allocationEntry(contributionId, allocatedPowerW, status = "allocated") {
    return {
        contributionId,
        contributor: (0, contributor_1.addonContributorRef)("immersion_heater"),
        slot: { startIso: SLOT_START, endIso: SLOT_END },
        status,
        energySource: "pv_surplus",
        requestedPowerW: allocatedPowerW,
        allocatedPowerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        gridPowerW: 0,
        pvPowerW: allocatedPowerW ?? 0,
        mandatory: contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "test",
    };
}
(0, node_test_1.describe)("immersion daily plan reader", () => {
    (0, node_test_1.it)("parses valid allocation JSON array", () => {
        const raw = [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)];
        const parsed = (0, daily_plan_js_1.parseDailyAllocationEntries)(JSON.stringify(raw));
        strict_1.default.ok(parsed);
        strict_1.default.equal(parsed.length, 1);
    });
    (0, node_test_1.it)("rejects invalid JSON", () => {
        strict_1.default.equal((0, daily_plan_js_1.parseDailyAllocationEntries)("{bad"), null);
    });
    (0, node_test_1.it)("rejects non-array JSON", () => {
        strict_1.default.equal((0, daily_plan_js_1.parseDailyAllocationEntries)({}), null);
    });
    (0, node_test_1.it)("merges mandatory and flexible without double counting", () => {
        const merge = (0, daily_plan_js_1.mergeSlotAllocations)([
            allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1000),
            allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 700),
        ], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, true);
        strict_1.default.equal(merge.mandatoryPowerW, 1000);
        strict_1.default.equal(merge.flexiblePowerW, 700);
        strict_1.default.equal(merge.totalPowerW, 1700);
    });
    (0, node_test_1.it)("detects duplicate slot allocation", () => {
        const merge = (0, daily_plan_js_1.mergeSlotAllocations)([
            allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1000),
            allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 500),
        ], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, false);
        strict_1.default.match(merge.reasonDe, /Doppelte/);
    });
    (0, node_test_1.it)("ignores inactive allocation statuses", () => {
        const merge = (0, daily_plan_js_1.mergeSlotAllocations)([allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 2000, "unallocated")], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.totalPowerW, 0);
        strict_1.default.equal(merge.allocationStatus, "none");
    });
    (0, node_test_1.it)("rejects null and negative allocation power", () => {
        strict_1.default.equal((0, daily_plan_js_1.mergeSlotAllocations)([allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, null)], SLOT_START, SLOT_END).valid, false);
        strict_1.default.equal((0, daily_plan_js_1.mergeSlotAllocations)([allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, -100)], SLOT_START, SLOT_END).valid, false);
    });
    (0, node_test_1.it)("accepts valid zero allocation", () => {
        const merge = (0, daily_plan_js_1.mergeSlotAllocations)([], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.valid, true);
        strict_1.default.equal(merge.totalPowerW, 0);
    });
    (0, node_test_1.it)("selects highest stage within allocation cap", () => {
        strict_1.default.equal((0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 1700).stageIndex, 1);
        strict_1.default.equal((0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 2000).stageIndex, 1);
        strict_1.default.equal((0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 3400).stageIndex, 2);
        strict_1.default.equal((0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 5000).stageIndex, 2);
        strict_1.default.equal((0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 5100).stageIndex, 3);
    });
    (0, node_test_1.it)("returns stage 0 when allocation below smallest stage", () => {
        const pick = (0, daily_plan_js_1.stageIndexForMaxPowerW)(MULTI_STAGE_CFG, 500);
        strict_1.default.equal(pick.stageIndex, 0);
        strict_1.default.match(pick.reasonDe, /kleiner als kleinste Stufe/);
    });
    (0, node_test_1.it)("resolves valid daily plan with positive allocation", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 3400)],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_valid");
        strict_1.default.equal(r.commandedStage, 2);
        strict_1.default.equal(r.allocatedPowerW, 3400);
        strict_1.default.equal(r.mandatoryAllocatedPowerW, 3400);
    });
    (0, node_test_1.it)("zero allocation keeps Daily Plan ownership (absichtlich aus, kein Fallback)", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.equal(r.decisionSource, "daily_plan");
        strict_1.default.match(r.allocationReasonDe, /ohne Heizstab-Leistung/);
        strict_1.default.doesNotMatch(r.allocationReasonDe, /Thermal-Fallback/);
    });
    (0, node_test_1.it)("continueHeating bridges zero NOW-slot to next allocated slot (anti chatter)", () => {
        const next = {
            ...allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700),
            slot: { startIso: SLOT_END, endIso: "2026-07-11T10:30:00.000Z" },
        };
        const off = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [next],
            config: MULTI_STAGE_CFG,
            continueHeating: false,
        });
        strict_1.default.equal(off.commandedStage, 0);
        const hold = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [next],
            config: MULTI_STAGE_CFG,
            continueHeating: true,
        });
        strict_1.default.equal(hold.commandedStage, 1);
        strict_1.default.equal(hold.dailyPlanStatus, "daily_plan_valid");
        strict_1.default.match(hold.allocationReasonDe, /Slot-Brücke|Anti-Takten/);
    });
    (0, node_test_1.it)("liveSurplusHold bridges zero NOW-slot when surplus persists (no next slot allocation)", () => {
        const holdInput = (0, live_surplus_hold_js_1.computeImmersionLiveSurplusHold)({
            pvPowerW: 5000,
            houseLoadW: 3000,
            immersionOnPowerW: 1700,
            bufferTempC: 45,
            targetTempC: 58,
            planningMaxTempC: 65,
            continueHeating: true,
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(holdInput.active, true);
        const off = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [],
            config: MULTI_STAGE_CFG,
            continueHeating: true,
            liveSurplusHold: holdInput,
        });
        strict_1.default.equal(off.commandedStage, 1);
        strict_1.default.equal(off.dailyPlanStatus, "daily_plan_valid");
        strict_1.default.match(off.allocationReasonDe, /Live-PV-Überschuss|Durchlauf/);
    });
    (0, node_test_1.it)("allocation below smallest stage is Daily Plan off (not thermal fallback)", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 8)],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.equal(r.allocatedPowerW, 8);
        strict_1.default.equal(r.decisionSource, "daily_plan");
        strict_1.default.match(r.allocationReasonDe, /keine fahrbare Stufe/);
    });
    (0, node_test_1.it)("falls back on wrong date", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_wrong_date");
        strict_1.default.match(r.allocationReasonDe, /Thermal-Fallback/);
    });
    (0, node_test_1.it)("falls back on expired plan", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: {
                status: "ready",
                date: "2026-07-11",
                revision: 1,
                validUntil: "2026-07-11T09:00:00.000Z",
                timezone: TZ,
            },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_expired");
    });
    (0, node_test_1.it)("falls back on invalid plan status", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "error", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, false);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_invalid");
    });
    (0, node_test_1.it)("accepts degraded plan status", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "degraded", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700)],
            config: MULTI_STAGE_CFG,
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.flexibleAllocatedPowerW, 1700);
    });
    (0, node_test_1.it)("attaches effective thermal target from same plan revision", () => {
        const r = (0, daily_plan_js_1.resolveImmersionDailyPlanFromData)({
            now: NOW,
            timezone: TZ,
            meta: { status: "ready", date: "2026-07-11", revision: 7, validUntil: null, timezone: TZ },
            entries: [allocationEntry(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700)],
            config: MULTI_STAGE_CFG,
            thermalTarget: {
                effectiveTargetTempC: 59,
                forecastTargetTempC: 51.6,
                targetReasonDe: "PV-Vorladung: Wärme für Abend/Nacht speichern",
                targetRevision: 7,
            },
        });
        strict_1.default.equal(r.useDailyPlan, true);
        strict_1.default.equal(r.effectiveTargetTempC, 59);
        strict_1.default.equal(r.forecastTargetTempC, 51.6);
        strict_1.default.equal(r.targetRevision, 7);
        strict_1.default.match(r.targetReasonDe ?? "", /PV-Vorladung/);
    });
    (0, node_test_1.it)("rejects unknown contribution in merge path via invalid allocation", () => {
        const bad = allocationEntry("wallbox.ev_session", 1000);
        const merge = (0, daily_plan_js_1.mergeSlotAllocations)([bad], SLOT_START, SLOT_END);
        strict_1.default.equal(merge.totalPowerW, 0);
    });
    (0, node_test_1.it)("decision source priority mapping", () => {
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("off", false, false, "off", "daily_plan"), "manual_off");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("force", false, false, "force_heating", "daily_plan"), "manual_force");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("auto", true, false, "off", "daily_plan"), "safety");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("auto", false, true, "fault_lockout", "daily_plan"), "lockout");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("auto", false, true, "off", "daily_plan"), "fault");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("auto", false, false, "auto_heating", "daily_plan"), "daily_plan");
        strict_1.default.equal((0, daily_plan_js_1.resolveImmersionDecisionSource)("auto", false, false, "auto_heating", "thermal_fallback"), "thermal_fallback");
    });
    (0, node_test_1.it)("resets cache helper", () => {
        (0, daily_plan_js_1.resetImmersionDailyPlanCache)();
        strict_1.default.ok(true);
    });
});

"use strict";
/**
 * Eine Desired-Authority — Plan + Demand in computeAcCoolingDesired.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const compute_desired_1 = require("./compute_desired");
function fsm(over = {}) {
    return {
        state: "idle",
        demandStart: false,
        demandStop: false,
        modePurpose: "cooling",
        reasonDe: "test",
        ...over,
    };
}
function plan(over = {}) {
    return {
        unitIndex: 1,
        contributionId: "air_conditioning.unit_1",
        dailyPlanStatus: "daily_plan_valid",
        dailyPlanRevision: 1,
        slotStartIso: "2026-08-11T09:30:00.000Z",
        slotEndIso: "2026-08-11T09:45:00.000Z",
        allocatedPowerW: 850,
        expectedPowerW: 850,
        powerModelSource: "config",
        allocationStatus: "allocated",
        allocationReasonDe: "test",
        useDailyPlan: true,
        powerModelValid: true,
        allocationAllowsStart: true,
        ...over,
    };
}
const base = {
    unitEnabled: true,
    governanceEnabled: true,
    addonEnabled: true,
    cleaningActive: false,
    startRetryReady: true,
};
(0, node_test_1.describe)("computeAcCoolingDesired — single authority", () => {
    (0, node_test_1.it)("T1: planner ON + demand start + fb off → desired on", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ demandStart: true, reasonDe: "Temp hoch — Einschalten." }),
            dailyPlan: plan(),
            feedbackOn: false,
        });
        strict_1.default.equal(d.desired, "on");
        strict_1.default.equal(d.allowStart, true);
        strict_1.default.equal(d.allowStop, false);
        strict_1.default.equal(d.plannerOff, false);
    });
    (0, node_test_1.it)("T2/T3/T13/T14: planner ON + fb on + no demandStop → hold, never stop", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running", demandStart: false, demandStop: false }),
            dailyPlan: plan({ allocatedPowerW: 850 }),
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "hold");
        strict_1.default.equal(d.allowStop, false);
        strict_1.default.equal(d.allowStart, false);
    });
    (0, node_test_1.it)("T4: same allocation new revision → still hold when fb on", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running" }),
            dailyPlan: plan({ dailyPlanRevision: 99, allocatedPowerW: 850 }),
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "hold");
        strict_1.default.equal(d.allowStop, false);
    });
    (0, node_test_1.it)("T5: explicit replan 0 W → off when fb on", () => {
        const p = plan({
            allocatedPowerW: 0,
            allocationStatus: "allocated",
            dailyPlanStatus: "daily_plan_zero_allocation",
            allocationAllowsStart: false,
        });
        strict_1.default.equal((0, compute_desired_1.isExplicitPlannerOff)(p), true);
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running", demandStop: false }),
            dailyPlan: p,
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "off");
        strict_1.default.equal(d.allowStop, true);
        strict_1.default.equal(d.plannerOff, true);
    });
    (0, node_test_1.it)("runtimeHold empty NOW (status none) is NOT plannerOff — hold while running", () => {
        const p = plan({
            allocatedPowerW: 0,
            allocationStatus: "none",
            dailyPlanStatus: "daily_plan_zero_allocation",
            allocationAllowsStart: false,
        });
        strict_1.default.equal((0, compute_desired_1.isExplicitPlannerOff)(p), false);
        strict_1.default.equal((0, compute_desired_1.isSlotBudgetMissing)(p), true);
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running", demandStop: false }),
            dailyPlan: p,
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "hold");
        strict_1.default.equal(d.allowStop, false);
        strict_1.default.equal(d.plannerOff, false);
    });
    (0, node_test_1.it)("T7: demand fulfilled (demandStop) → off even with planner budget", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running", demandStop: true, reasonDe: "Temp niedrig — Abschalten." }),
            dailyPlan: plan(),
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "off");
        strict_1.default.equal(d.allowStop, true);
        strict_1.default.equal(d.plannerOff, false);
    });
    (0, node_test_1.it)("T8: explicit planner OFF → stop", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "running" }),
            dailyPlan: plan({
                allocatedPowerW: 0,
                allocationStatus: "allocated",
                allocationAllowsStart: false,
            }),
            feedbackOn: true,
        });
        strict_1.default.equal(d.desired, "off");
        strict_1.default.equal(d.allowStop, true);
    });
    (0, node_test_1.it)("T9: planner OFF + fb already off → idle, no stop write intent", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            fsm: fsm({ state: "idle" }),
            dailyPlan: plan({
                allocatedPowerW: 0,
                allocationStatus: "allocated",
                allocationAllowsStart: false,
            }),
            feedbackOn: false,
        });
        strict_1.default.equal(d.desired, "idle");
        strict_1.default.equal(d.allowStop, false);
    });
    (0, node_test_1.it)("T10: rate-limit blocks start, does not create stop", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            startRetryReady: false,
            fsm: fsm({ demandStart: true }),
            dailyPlan: plan(),
            feedbackOn: false,
        });
        strict_1.default.equal(d.desired, "idle");
        strict_1.default.equal(d.allowStart, false);
        strict_1.default.equal(d.allowStop, false);
        strict_1.default.equal(d.decisionSource, "rate_limited");
    });
    (0, node_test_1.it)("T11: cleaning → no cool start/stop authority", () => {
        const d = (0, compute_desired_1.computeAcCoolingDesired)({
            ...base,
            cleaningActive: true,
            fsm: fsm({ state: "running", demandStop: true }),
            dailyPlan: plan(),
            feedbackOn: true,
        });
        strict_1.default.equal(d.allowStart, false);
        strict_1.default.equal(d.allowStop, false);
        strict_1.default.equal(d.decisionSource, "cleaning");
    });
});

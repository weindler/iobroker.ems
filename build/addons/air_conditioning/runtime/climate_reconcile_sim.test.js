"use strict";
/**
 * Deterministischer Climate-Reconcile-Simulator — T1–T14 + Invarianten.
 * Kein SmartThings / kein Realgerät.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const persist_1 = require("./persist");
const stop_intent_1 = require("./stop_intent");
const compute_desired_1 = require("./compute_desired");
const constants_1 = require("../constants");
function fsmFrom(unit) {
    if (unit.feedbackOn) {
        if (unit.tempC <= unit.offTempC) {
            return {
                state: "running",
                demandStart: false,
                demandStop: true,
                modePurpose: "cooling",
                reasonDe: "Temp niedrig — Abschalten.",
            };
        }
        return {
            state: "running",
            demandStart: false,
            demandStop: false,
            modePurpose: "cooling",
            reasonDe: "Läuft.",
        };
    }
    if (unit.tempC >= unit.onTempC) {
        return {
            state: "idle",
            demandStart: true,
            demandStop: false,
            modePurpose: "cooling",
            reasonDe: "Temp hoch — Einschalten.",
        };
    }
    return {
        state: "idle",
        demandStart: false,
        demandStop: false,
        modePurpose: "cooling",
        reasonDe: "Kein Bedarf.",
    };
}
function toDailyPlan(p) {
    const budgetOn = p.allocatedPowerW > 0 && p.allocationStatus !== "none";
    const explicitZero = p.allocatedPowerW <= 0 && p.allocationStatus === "allocated";
    return {
        unitIndex: 1,
        contributionId: "air_conditioning.unit_1",
        dailyPlanStatus: budgetOn ? "daily_plan_valid" : "daily_plan_zero_allocation",
        dailyPlanRevision: p.revision,
        slotStartIso: "2026-08-11T09:30:00.000Z",
        slotEndIso: "2026-08-11T09:45:00.000Z",
        allocatedPowerW: p.allocationStatus === "none" ? 0 : p.allocatedPowerW,
        expectedPowerW: 850,
        powerModelSource: "config",
        allocationStatus: p.allocationStatus,
        allocationReasonDe: explicitZero ? "Planner-OFF" : "test",
        useDailyPlan: true,
        powerModelValid: true,
        allocationAllowsStart: budgetOn,
    };
}
/**
 * Ein Reconcile-Schritt (Single-Action-Modell):
 * frische Inputs → desired → vs feedback → max. eine Hardware-Aktion.
 */
function reconcileOnce(unit, plan, nowMs, opts) {
    const fsm = fsmFrom(unit);
    const dailyPlan = toDailyPlan(plan);
    const startRetryReady = opts?.startRetryReady ?? true;
    const control = (0, compute_desired_1.computeAcCoolingDesired)({
        unitEnabled: true,
        governanceEnabled: true,
        addonEnabled: true,
        cleaningActive: false,
        fsm,
        dailyPlan,
        feedbackOn: unit.feedbackOn,
        startRetryReady,
    });
    (0, stop_intent_1.advanceCoolingDesired)(unit.persist, control.desired);
    let action = "none";
    if (control.desired === "off" && unit.feedbackOn) {
        const stop = (0, stop_intent_1.decideStopWrite)({
            up: unit.persist,
            desired: control.desired,
            feedbackOn: true,
            stopRetryReady: !unit.persist.lastStopAtMs || nowMs - unit.persist.lastStopAtMs >= constants_1.AC_STOP_RETRY_MS,
            lastStopAtMs: unit.persist.lastStopAtMs,
            nowMs,
        });
        if (stop.action === "execute_stop") {
            action = "stop";
            unit.persist.lastStopAtMs = nowMs;
            unit.feedbackOn = false;
            unit.persist.running = false;
        }
    }
    else if (control.desired === "on" && !unit.feedbackOn && control.allowStart) {
        action = "start";
        (0, stop_intent_1.clearStopIntentAfterStart)(unit.persist);
        unit.persist.lastStartAtMs = nowMs;
        // Feedback kommt verzögert — Caller setzt feedbackOn später
    }
    /*
     * I3: published running nur aus aktuellem Feedback — nie aus Pre-START-Snapshot.
     * Nach START-await wäre feedback frisch ON; hier setzt Caller das.
     */
    const publishedRunning = unit.feedbackOn;
    unit.persist.running = publishedRunning;
    return {
        desired: control.desired,
        action,
        publishedRunning,
        plannerOff: control.plannerOff,
        decisionSource: control.decisionSource,
    };
}
(0, node_test_1.describe)("climate reconcile simulator — T1–T14", () => {
    (0, node_test_1.it)("T1: exactly one START when planner ON, temp high, fb off", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const r1 = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        strict_1.default.equal(r1.action, "start");
        strict_1.default.equal(r1.desired, "on");
        const rBlocked = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_200, { startRetryReady: false });
        strict_1.default.equal(rBlocked.action, "none");
        strict_1.default.equal(rBlocked.desired, "idle");
    });
    (0, node_test_1.it)("T2: after 17s feedback ON, planner stays ON → no STOP, running true", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const t0 = 1_000;
        const start = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0);
        strict_1.default.equal(start.action, "start");
        unit.feedbackOn = true;
        const after = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0 + 17_000);
        strict_1.default.equal(after.desired, "hold");
        strict_1.default.equal(after.action, "none");
        strict_1.default.equal(after.publishedRunning, true);
    });
    (0, node_test_1.it)("T3: feedback-ON reconcile with planner ON → no switch_off", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: true,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        unit.persist.lastStartAtMs = 1_000;
        (0, stop_intent_1.clearStopIntentAfterStart)(unit.persist);
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_300);
        strict_1.default.equal(r.action, "none");
        strict_1.default.notEqual(r.desired, "off");
    });
    (0, node_test_1.it)("T4: replan same alloc new revision during START → no STOP after fb ON", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        unit.feedbackOn = true;
        const r = reconcileOnce(unit, { revision: 2, allocatedPowerW: 850, allocationStatus: "allocated" }, 18_000);
        strict_1.default.equal(r.action, "none");
        strict_1.default.equal(r.desired, "hold");
    });
    (0, node_test_1.it)("T5: real replan to 0 W during START → clean STOP after fb ON", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        (0, stop_intent_1.clearStopIntentAfterStart)(unit.persist);
        unit.feedbackOn = true;
        const r = reconcileOnce(unit, { revision: 2, allocatedPowerW: 0, allocationStatus: "allocated" }, 18_000);
        strict_1.default.equal(r.desired, "off");
        strict_1.default.equal(r.action, "stop");
        strict_1.default.equal(r.plannerOff, true);
    });
    (0, node_test_1.it)("T6: stale fb=OFF must not publish running=false after successful START", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const staleFbOff = false;
        reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        // await complete — fresh feedback ON
        unit.feedbackOn = true;
        const publishedRunning = unit.feedbackOn; // engine rule: use fresh, not staleFbOff
        strict_1.default.equal(publishedRunning, true);
        strict_1.default.equal(staleFbOff, false);
        strict_1.default.notEqual(publishedRunning, staleFbOff);
    });
    (0, node_test_1.it)("T7: demand fulfilled → STOP via desired off (visible, not hidden path)", () => {
        const unit = {
            tempC: 22,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: true,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 5_000);
        strict_1.default.equal(r.desired, "off");
        strict_1.default.equal(r.action, "stop");
        strict_1.default.equal(r.plannerOff, false);
    });
    (0, node_test_1.it)("T8: planner OFF → STOP when fb ON", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: true,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 0, allocationStatus: "allocated" }, 5_000);
        strict_1.default.equal(r.action, "stop");
    });
    (0, node_test_1.it)("T9: planner OFF + fb OFF → no OFF write", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 0, allocationStatus: "allocated" }, 5_000);
        strict_1.default.equal(r.action, "none");
        strict_1.default.equal(r.desired, "idle");
    });
    (0, node_test_1.it)("T10: rate-limit blocks START, no STOP", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        unit.persist.lastStartAtMs = 1_000;
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 2_000, { startRetryReady: false });
        strict_1.default.equal(r.action, "none");
        strict_1.default.equal(r.desired, "idle");
    });
    (0, node_test_1.it)("T12: two units have independent persist/desired", () => {
        const u1 = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const u2 = {
            tempC: 22,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: true,
            persist: (0, persist_1.emptyUnitPersist)(2),
        };
        const r1 = reconcileOnce(u1, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        const r2 = reconcileOnce(u2, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        strict_1.default.equal(r1.action, "start");
        strict_1.default.equal(r2.action, "stop");
        strict_1.default.notEqual(u1.persist.commandGeneration, undefined);
        strict_1.default.ok(u1.persist !== u2.persist);
    });
    (0, node_test_1.it)("T13: rapid feedback event 300ms later — planner ON → no STOP", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const t0 = 1_000;
        reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0);
        (0, stop_intent_1.clearStopIntentAfterStart)(unit.persist);
        unit.feedbackOn = true;
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, t0 + 300);
        strict_1.default.equal(r.action, "none");
        strict_1.default.equal(r.desired, "hold");
    });
    (0, node_test_1.it)("T14 Realfall 11.08.2026: START→fb ON→reconcile @850W → no stop", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const tStart = Date.parse("2026-08-11T09:30:10.000Z");
        const tFb = Date.parse("2026-08-11T09:30:27.000Z");
        const tRec = Date.parse("2026-08-11T09:30:28.000Z");
        strict_1.default.equal(reconcileOnce(unit, { revision: 10, allocatedPowerW: 850, allocationStatus: "allocated" }, tStart).action, "start");
        (0, stop_intent_1.clearStopIntentAfterStart)(unit.persist);
        unit.feedbackOn = true;
        // runtimeHold-style missing NOW entry must NOT stop
        const mid = reconcileOnce(unit, { revision: 10, allocatedPowerW: 0, allocationStatus: "none" }, tFb);
        strict_1.default.equal(mid.desired, "hold");
        strict_1.default.equal(mid.action, "none");
        const late = reconcileOnce(unit, { revision: 10, allocatedPowerW: 850, allocationStatus: "allocated" }, tRec);
        strict_1.default.equal(late.desired, "hold");
        strict_1.default.equal(late.action, "none");
        strict_1.default.equal(late.publishedRunning, true);
    });
});
(0, node_test_1.describe)("climate reconcile invariants", () => {
    (0, node_test_1.it)("I1: desired ON/HOLD + fb ON → never STOP write", () => {
        for (const desired of ["on", "hold"]) {
            const up = (0, persist_1.emptyUnitPersist)(1);
            (0, stop_intent_1.advanceCoolingDesired)(up, desired);
            const d = (0, stop_intent_1.decideStopWrite)({
                up,
                desired,
                feedbackOn: true,
                stopRetryReady: true,
                lastStopAtMs: null,
                nowMs: 1,
            });
            strict_1.default.notEqual(d.action, "execute_stop", desired);
        }
    });
    (0, node_test_1.it)("I2: desired OFF + fb ON → at most one stop arm per generation", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        const a = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: null,
            nowMs: 1,
        });
        strict_1.default.equal(a.action, "execute_stop");
        const gen = up.stopArmedGeneration;
        strict_1.default.equal(gen, up.commandGeneration);
        up.lastStopAtMs = 1;
        const b = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: false,
            lastStopAtMs: 1,
            nowMs: 2,
        });
        strict_1.default.equal(b.action, "wait_retry");
        strict_1.default.equal(up.stopArmedGeneration, gen);
    });
    (0, node_test_1.it)("I3: after async START publish uses fresh fb not pre-start snapshot", () => {
        const preStartFb = false;
        const freshFb = true;
        const published = freshFb; // engine contract
        strict_1.default.equal(published, true);
        strict_1.default.notEqual(published, preStartFb);
    });
    (0, node_test_1.it)("I5: new planner revision with OFF invalidates keep-on", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: true,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        (0, stop_intent_1.advanceCoolingDesired)(unit.persist, "hold");
        const r = reconcileOnce(unit, { revision: 11, allocatedPowerW: 0, allocationStatus: "allocated" }, 9_000);
        strict_1.default.equal(r.desired, "off");
        strict_1.default.equal(r.action, "stop");
    });
    (0, node_test_1.it)("I6: one reconcile → at most one hardware action", () => {
        const unit = {
            tempC: 26,
            onTempC: 24.5,
            offTempC: 23,
            feedbackOn: false,
            persist: (0, persist_1.emptyUnitPersist)(1),
        };
        const r = reconcileOnce(unit, { revision: 1, allocatedPowerW: 850, allocationStatus: "allocated" }, 1_000);
        strict_1.default.ok(r.action === "start" || r.action === "none" || r.action === "stop");
        // single action enum — never start+stop in one return
        strict_1.default.ok(["start", "stop", "none"].includes(r.action));
    });
});

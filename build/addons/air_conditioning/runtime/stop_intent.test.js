"use strict";
/**
 * Climate stale STOP-retry — T1–T8 + E2E (Realfall 11.08.2026).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const persist_1 = require("./persist");
const stop_intent_1 = require("./stop_intent");
const constants_1 = require("../constants");
function perm(overrides = {}) {
    return {
        decisionSource: "daily_plan",
        reasonDe: "test",
        allowStart: false,
        allowStop: false,
        allowCleaningWrites: true,
        deviceWritesAllowed: true,
        ...overrides,
    };
}
function fsm(overrides = {}) {
    return {
        state: "running",
        demandStart: false,
        demandStop: false,
        modePurpose: "cooling",
        reasonDe: "Läuft.",
        ...overrides,
    };
}
function plan(allocatedPowerW, useDailyPlan = true) {
    return {
        unitIndex: 1,
        contributionId: "air_conditioning.unit_1",
        dailyPlanStatus: allocatedPowerW != null && allocatedPowerW > 0 ? "daily_plan_valid" : "daily_plan_zero_allocation",
        dailyPlanRevision: 1,
        slotStartIso: "2026-08-11T09:00:00.000Z",
        slotEndIso: "2026-08-11T09:15:00.000Z",
        allocatedPowerW,
        expectedPowerW: 850,
        powerModelSource: "config",
        allocationStatus: "allocated",
        allocationReasonDe: "test",
        useDailyPlan,
        powerModelValid: true,
        allocationAllowsStart: (allocatedPowerW ?? 0) > 0,
    };
}
(0, node_test_1.describe)("climate stop intent — T1 current OFF retry allowed", () => {
    (0, node_test_1.it)("T1: pending stop under lasting OFF → execute retry", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        const first = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: null,
            nowMs: 1_000,
        });
        strict_1.default.equal(first.action, "execute_stop");
        up.lastStopAtMs = 1_000;
        up.stopArmedGeneration = up.commandGeneration;
        const retry = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: up.lastStopAtMs,
            nowMs: 1_000 + constants_1.AC_STOP_RETRY_MS + 1,
        });
        strict_1.default.equal(retry.action, "execute_stop");
        strict_1.default.equal(retry.action === "execute_stop" && retry.isRetry, true);
    });
});
(0, node_test_1.describe)("climate stop intent — T2 OFF→ON cancels retry", () => {
    (0, node_test_1.it)("T2: stop armed under OFF, then ON → cancel, no execute", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: false,
            lastStopAtMs: null,
            nowMs: 1_000,
        });
        strict_1.default.ok(up.stopArmedGeneration != null);
        const cleared = (0, stop_intent_1.advanceCoolingDesired)(up, "on");
        strict_1.default.equal(cleared.stopCleared, true);
        strict_1.default.equal(up.stopArmedGeneration, null);
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "on",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: 500,
            nowMs: 2_000,
        });
        strict_1.default.equal(d.action, "none");
    });
});
(0, node_test_1.describe)("climate stop intent — T3 start then feedback ON", () => {
    (0, node_test_1.it)("T3: successful START clears stale stop; hold under planner ON → no OFF write", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        up.stopArmedGeneration = up.commandGeneration;
        up.lastStopAtMs = 100;
        up.lastStartAtMs = 200;
        (0, stop_intent_1.clearStopIntentAfterStart)(up);
        strict_1.default.equal(up.stopArmedGeneration, null);
        strict_1.default.equal(up.lastStopAtMs, null);
        const desired = (0, stop_intent_1.resolveCoolingDesired)({
            permission: perm({ allowStop: false, allowStart: false }),
            fsm: fsm({ demandStop: false }),
            dailyPlan: plan(850),
            feedbackOn: true,
        });
        strict_1.default.equal(desired, "hold");
        (0, stop_intent_1.advanceCoolingDesired)(up, desired);
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired,
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: up.lastStopAtMs,
            nowMs: 300,
        });
        strict_1.default.notEqual(d.action, "execute_stop");
    });
});
(0, node_test_1.describe)("climate stop intent — T4 revision/generation", () => {
    (0, node_test_1.it)("T4: stop from rev A must not execute under later ON generations", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off"); // gen 1
        const armGen = up.commandGeneration;
        up.stopArmedGeneration = armGen;
        (0, stop_intent_1.advanceCoolingDesired)(up, "on"); // gen 2 — clears
        (0, stop_intent_1.advanceCoolingDesired)(up, "hold"); // gen 3
        strict_1.default.equal(up.stopArmedGeneration, null);
        /** Simulate leaked stale arm from gen 1 */
        up.stopArmedGeneration = armGen;
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: 1,
            nowMs: 9_000,
        });
        /** desired off re-arms under CURRENT gen — stale gen cancelled first */
        strict_1.default.ok(d.action === "cancel_stale" || d.action === "execute_stop");
        if (d.action === "cancel_stale") {
            strict_1.default.match(d.reasonDe, /superseded|ON/i);
        }
        /** After cancel, a fresh OFF arm under current gen may execute: */
        const d2 = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: 1,
            nowMs: 9_001,
        });
        strict_1.default.equal(d2.action, "execute_stop");
        strict_1.default.equal(up.stopArmedGeneration, up.commandGeneration);
        strict_1.default.notEqual(up.stopArmedGeneration, armGen);
    });
});
(0, node_test_1.describe)("climate stop intent — T5 real new OFF still works", () => {
    (0, node_test_1.it)("T5: after ON/HOLD, new OFF executes stop", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "hold");
        (0, stop_intent_1.clearStopIntentAfterStart)(up);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired: "off",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: null,
            nowMs: 5_000,
        });
        strict_1.default.equal(d.action, "execute_stop");
        strict_1.default.equal(d.action === "execute_stop" && d.isRetry, false);
    });
});
(0, node_test_1.describe)("climate stop intent — T6 late feedback", () => {
    (0, node_test_1.it)("T6: old OFF intent + interim ON + late feedback → no stale STOP", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        up.stopArmedGeneration = up.commandGeneration;
        up.lastStopAtMs = 1_000;
        (0, stop_intent_1.advanceCoolingDesired)(up, "on");
        (0, stop_intent_1.clearStopIntentAfterStart)(up);
        up.lastStartAtMs = 2_000;
        const desired = (0, stop_intent_1.resolveCoolingDesired)({
            permission: perm({ allowStop: false }),
            fsm: fsm(),
            dailyPlan: plan(850),
            feedbackOn: true,
        });
        strict_1.default.equal(desired, "hold");
        (0, stop_intent_1.advanceCoolingDesired)(up, desired);
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired,
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: up.lastStopAtMs,
            nowMs: 3_000,
        });
        strict_1.default.notEqual(d.action, "execute_stop");
    });
});
(0, node_test_1.describe)("climate stop intent — T7 units independent", () => {
    (0, node_test_1.it)("T7: unit1 stop campaign does not affect unit2", () => {
        const u1 = (0, persist_1.emptyUnitPersist)(1);
        const u2 = (0, persist_1.emptyUnitPersist)(2);
        (0, stop_intent_1.advanceCoolingDesired)(u1, "off");
        u1.stopArmedGeneration = u1.commandGeneration;
        (0, stop_intent_1.advanceCoolingDesired)(u2, "hold");
        strict_1.default.ok(u1.stopArmedGeneration != null);
        strict_1.default.equal(u2.stopArmedGeneration, null);
        const d2 = (0, stop_intent_1.decideStopWrite)({
            up: u2,
            desired: "hold",
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: null,
            nowMs: 1,
        });
        strict_1.default.notEqual(d2.action, "execute_stop");
    });
});
(0, node_test_1.describe)("climate stop intent — T8 realfall 11.08.2026", () => {
    (0, node_test_1.it)("T8: 13min-old stop + new ON start + feedback ON + retry timer → no OFF", () => {
        const up = (0, persist_1.emptyUnitPersist)(1);
        const t0 = Date.parse("2026-08-11T08:47:00.000Z");
        const tStart = Date.parse("2026-08-11T09:00:10.000Z");
        const tRetry = Date.parse("2026-08-11T09:01:16.000Z");
        (0, stop_intent_1.advanceCoolingDesired)(up, "off");
        up.lastStopAtMs = t0;
        up.stopArmedGeneration = up.commandGeneration;
        /** Neuer Planner-Slot ON → START */
        (0, stop_intent_1.advanceCoolingDesired)(up, "on");
        up.lastStartAtMs = tStart;
        (0, stop_intent_1.clearStopIntentAfterStart)(up);
        strict_1.default.equal(up.lastStopAtMs, null);
        strict_1.default.equal(up.stopArmedGeneration, null);
        const desired = (0, stop_intent_1.resolveCoolingDesired)({
            permission: perm({
                allowStart: false,
                allowStop: false,
                decisionSource: "daily_plan",
            }),
            fsm: fsm({
                demandStart: false,
                demandStop: false,
                reasonDe: "Läuft (Temp 26.0 °C ≥ 24.5 °C — cool).",
            }),
            dailyPlan: plan(850),
            feedbackOn: true,
        });
        strict_1.default.equal(desired, "hold");
        strict_1.default.equal((0, stop_intent_1.plannerCoolingBudgetOn)(plan(850)), true);
        (0, stop_intent_1.advanceCoolingDesired)(up, desired);
        strict_1.default.ok(tRetry - t0 > 800_000, "simulates ~13 min since last stop attempt");
        const d = (0, stop_intent_1.decideStopWrite)({
            up,
            desired,
            feedbackOn: true,
            stopRetryReady: true,
            lastStopAtMs: up.lastStopAtMs,
            nowMs: tRetry,
        });
        strict_1.default.notEqual(d.action, "execute_stop");
        strict_1.default.ok(d.action === "none" || d.action === "cancel_stale");
    });
});
(0, node_test_1.describe)("climate stop intent — E2E reconcile chain", () => {
    (0, node_test_1.it)("E2E: OFF arm → ON start → hold → retry window → no stale STOP", () => {
        const up = (0, persist_1.emptyUnitPersist)(2);
        const writes = [];
        const run = (desiredLabel, feedbackOn, nowMs) => {
            const dailyPlan = plan(desiredLabel === "off" ? 0 : 850);
            const permission = perm({
                allowStop: desiredLabel === "off",
                allowStart: desiredLabel === "on" && !feedbackOn,
            });
            const desired = (0, stop_intent_1.resolveCoolingDesired)({
                permission,
                fsm: fsm({
                    demandStop: desiredLabel === "off" && feedbackOn ? false : false,
                    demandStart: desiredLabel === "on" && !feedbackOn,
                }),
                dailyPlan,
                feedbackOn,
            });
            /** Force desired for E2E script (permission already set). */
            const forced = desiredLabel === "off" ? "off" : desiredLabel === "on" ? (feedbackOn ? "hold" : "on") : "hold";
            (0, stop_intent_1.advanceCoolingDesired)(up, forced);
            if (forced === "on" && !feedbackOn) {
                up.lastStartAtMs = nowMs;
                (0, stop_intent_1.clearStopIntentAfterStart)(up);
                writes.push("start");
            }
            const d = (0, stop_intent_1.decideStopWrite)({
                up,
                desired: forced,
                feedbackOn,
                stopRetryReady: !up.lastStopAtMs || nowMs - (up.lastStopAtMs ?? 0) >= constants_1.AC_STOP_RETRY_MS,
                lastStopAtMs: up.lastStopAtMs,
                nowMs,
            });
            if (d.action === "execute_stop") {
                writes.push("stop");
                up.lastStopAtMs = nowMs;
            }
            else if (d.action === "cancel_stale") {
                writes.push("cancel");
            }
            void desired;
        };
        run("off", true, 1_000);
        run("off", true, 1_000); // arm / first stop
        strict_1.default.ok(writes.includes("stop"));
        run("on", false, 2_000);
        strict_1.default.ok(writes.includes("start"));
        run("hold", true, 2_500);
        run("hold", true, 2_500 + constants_1.AC_STOP_RETRY_MS + 5_000);
        strict_1.default.equal(writes.filter((w) => w === "stop").length, 1, "no second stale stop after ON");
        strict_1.default.ok(!writes.slice(writes.indexOf("start")).includes("stop"));
    });
});

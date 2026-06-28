"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fsm_js_1 = require("./fsm.js");
const MODE = { manual: 1, selfConsumption: 2 };
const SEQ = {
    pauseBeforeManualMs: 0,
    waitAfterManualMs: 0,
    feedbackTimeoutModeMs: 30_000,
    feedbackTimeoutChargeMs: 30_000,
    maxManualModeMs: 1_000_000,
    restoreDelayMs: 0,
};
const TOL = { absoluteW: 100, relativePct: 10 };
function baseCtx(over, nowMs) {
    return {
        nowMs,
        intentValid: true,
        chargingActionRequested: true,
        action: "charge",
        requestId: "r1",
        effectiveChargeW: 2000,
        targetSocPct: null,
        stopReason: null,
        actualMode: MODE.manual,
        actualChargingW: 2000,
        socPct: 50,
        modeValues: MODE,
        sequence: SEQ,
        tolerance: TOL,
        gridBalanceActive: false,
        simulateFeedback: false,
        ...over,
    };
}
function drive(rt, overFor, steps, startMs) {
    let now = startMs;
    const writes = [];
    const gb = [];
    let cur = rt;
    for (let i = 0; i < steps; i++) {
        now += 1000;
        const step = (0, fsm_js_1.stepSonnenFsm)(cur, baseCtx(overFor(cur), now));
        cur = step.runtime;
        writes.push(...step.writes);
        if (step.gridBalance)
            gb.push(step.gridBalance);
    }
    return { rt: cur, writes, gb };
}
(0, node_test_1.describe)("sonnen FSM", () => {
    (0, node_test_1.it)("runs full live charge sequence in correct write order", () => {
        const rt = (0, fsm_js_1.initialSonnenRuntime)(0);
        const res = drive(rt, () => ({}), 12, 0);
        strict_1.default.equal(res.rt.state, "active");
        strict_1.default.equal(res.writes.length, 2);
        strict_1.default.equal(res.writes[0].kind, "operating_mode");
        strict_1.default.equal(res.writes[0].value, MODE.manual);
        strict_1.default.equal(res.writes[1].kind, "charge_power");
        strict_1.default.equal(res.writes[1].value, 2000);
        strict_1.default.ok(res.gb.includes("pause"));
        strict_1.default.equal(res.rt.ownership.active, true);
    });
    (0, node_test_1.it)("dryrun simulates feedback to reach active", () => {
        const rt = (0, fsm_js_1.initialSonnenRuntime)(0);
        const res = drive(rt, () => ({ simulateFeedback: true, actualMode: null, actualChargingW: null }), 12, 0);
        strict_1.default.equal(res.rt.state, "active");
    });
    (0, node_test_1.it)("stop and restore on intent revoke", () => {
        let rt = (0, fsm_js_1.initialSonnenRuntime)(0);
        rt = drive(rt, () => ({ gridBalanceActive: true }), 12, 0).rt;
        strict_1.default.equal(rt.state, "active");
        const res = drive(rt, () => ({ chargingActionRequested: false, intentValid: false, stopReason: "intent_revoked", actualChargingW: 0, actualMode: MODE.selfConsumption }), 8, 20_000);
        strict_1.default.equal(res.rt.state, "completed");
        strict_1.default.equal(res.rt.ownership.active, false);
        const modeWrites = res.writes.filter((w) => w.kind === "operating_mode");
        strict_1.default.equal(modeWrites[modeWrites.length - 1].value, MODE.selfConsumption);
        strict_1.default.ok(res.gb.includes("restore"));
    });
    (0, node_test_1.it)("mode feedback timeout → fault → restore → lockout", () => {
        let rt = (0, fsm_js_1.initialSonnenRuntime)(0);
        // advance to verify_manual_mode without confirming
        rt = drive(rt, () => ({ actualMode: MODE.selfConsumption }), 7, 0).rt;
        strict_1.default.equal(rt.state, "verify_manual_mode");
        // force timeout: large elapsed, mode never confirms; then drive restore with self confirmation
        const res = drive(rt, (cur) => cur.state === "verify_self_consumption"
            ? { actualMode: MODE.selfConsumption, actualChargingW: 0 }
            : { actualMode: MODE.selfConsumption, actualChargingW: 0 }, 10, 100_000);
        strict_1.default.equal(res.rt.lockout, true);
        strict_1.default.equal(res.rt.faultCode, "mode_feedback_timeout");
        strict_1.default.equal(res.rt.state, "lockout");
    });
});

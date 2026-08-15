"use strict";
/**
 * Phase 5B controlled live test — one productive EVCC button command.
 * EV_EXECUTION_PHASE5_ENABLED stays false (no Dauerbetrieb).
 * Arming is in-memory; a persisted true is never reconstructed after restart.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyEvLiveTestOperatorInputs = exports.evaluateEvLiveTestPermit = exports.markEvLiveTestResult = exports.consumeEvLiveTest = exports.disarmEvLiveTest = exports.armEvLiveTest = exports.emptyEvLiveTestState = void 0;
function emptyEvLiveTestState() {
    return {
        armed: false,
        consumed: false,
        armedAtMs: null,
        consumedAtMs: null,
        command: null,
        result: "",
        blockReason: "",
        retriesBlocked: false,
    };
}
exports.emptyEvLiveTestState = emptyEvLiveTestState;
function armEvLiveTest(nowMs) {
    return {
        armed: true,
        consumed: false,
        armedAtMs: nowMs,
        consumedAtMs: null,
        command: null,
        result: "armed",
        blockReason: "",
        retriesBlocked: false,
    };
}
exports.armEvLiveTest = armEvLiveTest;
function disarmEvLiveTest(prev) {
    if (prev.consumed) {
        return {
            ...prev,
            armed: false,
            retriesBlocked: true,
            result: "disarmed_after_pulse",
            blockReason: "live_test_disarmed",
        };
    }
    return {
        ...emptyEvLiveTestState(),
        result: "disarmed",
        blockReason: "",
    };
}
exports.disarmEvLiveTest = disarmEvLiveTest;
function consumeEvLiveTest(prev, command, nowMs) {
    return {
        ...prev,
        armed: false,
        consumed: true,
        consumedAtMs: nowMs,
        command,
        result: "consumed",
        blockReason: "",
        retriesBlocked: false,
    };
}
exports.consumeEvLiveTest = consumeEvLiveTest;
function markEvLiveTestResult(prev, result) {
    if (!prev.consumed)
        return prev;
    return { ...prev, result };
}
exports.markEvLiveTestResult = markEvLiveTestResult;
function evaluateEvLiveTestPermit(input) {
    const desired = input.desiredMode;
    const wantsWrite = desired != null && desired !== "noop";
    const t = input.liveTest;
    if (t.retriesBlocked) {
        return { permit: false, blockReason: "live_test_disarmed", consumeOnSuccessfulWrite: false };
    }
    if (t.consumed) {
        const samePendingRetry = wantsWrite &&
            desired === t.command &&
            input.pendingActive === true &&
            input.pendingMode === t.command;
        if (samePendingRetry) {
            return { permit: true, blockReason: "", consumeOnSuccessfulWrite: false };
        }
        return { permit: false, blockReason: "live_test_consumed", consumeOnSuccessfulWrite: false };
    }
    if (!t.armed) {
        return { permit: false, blockReason: "live_test_not_armed", consumeOnSuccessfulWrite: false };
    }
    if (!wantsWrite) {
        return { permit: false, blockReason: "", consumeOnSuccessfulWrite: false };
    }
    return { permit: true, blockReason: "", consumeOnSuccessfulWrite: true };
}
exports.evaluateEvLiveTestPermit = evaluateEvLiveTestPermit;
function applyEvLiveTestOperatorInputs(input) {
    let next = input.prev;
    if (input.armedVal === true && input.armedAck === false) {
        next = armEvLiveTest(input.nowMs);
    }
    else if (input.armedVal === false && input.armedAck === false) {
        next = disarmEvLiveTest(next);
    }
    if (input.disarmVal === true) {
        next = disarmEvLiveTest(next);
    }
    return next;
}
exports.applyEvLiveTestOperatorInputs = applyEvLiveTestOperatorInputs;

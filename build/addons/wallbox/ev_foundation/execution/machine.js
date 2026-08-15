"use strict";
/**
 * Pending / feedback / retry state machine.
 * Pure: no I/O. Writes are proposed, never executed here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stepEvExecution = void 0;
const freshness_1 = require("./freshness");
const ownership_1 = require("./ownership");
const types_1 = require("./types");
function withExplain(session) {
    return session;
}
function abortPending(session, result, phase) {
    return withExplain({
        ...(0, types_1.clearPending)(session),
        phase,
        lastResult: result,
    });
}
function stepEvExecution(session, input) {
    let s = { ...session };
    if (input.desiredReason != null) {
        s.desiredReason = input.desiredReason;
    }
    if (input.retriesBlocked) {
        const pendingActive = s.pendingMode != null &&
            (s.phase === "command_sent" || s.phase === "awaiting_feedback" || s.phase === "retry");
        if (pendingActive &&
            s.pendingMode &&
            (0, freshness_1.isCommandFeedbackConfirmed)({
                actualMode: input.actualMode,
                pendingMode: s.pendingMode,
                lastCommandAtMs: s.lastCommandAtMs,
                modeTsMs: input.modeTsMs,
            })) {
            s = (0, ownership_1.grantOrClearOwnershipAfterFeedback)({
                ...(0, types_1.clearPending)(s),
                phase: "confirmed",
                lastConfirmedMode: s.pendingMode,
                lastFeedbackAtMs: input.nowMs,
                retryCount: 0,
                lastResult: "confirmed",
            }, input.nowMs);
            s.blockReason = "live_test_disarmed";
            return { session: s, writeMode: null };
        }
        s = abortPending(s, "live_test_disarmed", "idle");
        s.blockReason = "live_test_disarmed";
        s.failsafeReason = "";
        return { session: s, writeMode: null };
    }
    if (input.desiredMode === "noop") {
        s = abortPending(s, "noop", "idle");
        s.failsafeReason = "";
        s.blockReason = "";
        s.retryCount = 0;
        s.desiredReason = input.desiredReason || s.desiredReason || "no_wallbox_action";
        s.lastResult = "noop";
        return { session: s, writeMode: null };
    }
    if (input.failsafeReason) {
        s = abortPending(s, "failsafe", "failsafe");
        s.failsafeReason = input.failsafeReason;
        s.blockReason = input.failsafeReason;
        return { session: s, writeMode: null };
    }
    if (s.phase === "failsafe" && !input.failsafeReason) {
        s = {
            ...s,
            failsafeReason: "",
            retryCount: 0,
            phase: input.actualMode && input.actualMode === input.desiredMode ? "confirmed" : "idle",
            lastResult: "failsafe_cleared",
        };
    }
    if (!input.authorityIsEms) {
        s = abortPending(s, "blocked", "idle");
        s.blockReason = input.blockReason || "external_authority";
        s.failsafeReason = "";
        return { session: s, writeMode: null };
    }
    if (!input.writeAllowed) {
        s = abortPending(s, "blocked", s.phase === "confirmed" ? "confirmed" : "idle");
        s.blockReason = input.blockReason;
        s.failsafeReason = "";
        return { session: s, writeMode: null };
    }
    s.blockReason = "";
    s.failsafeReason = "";
    const pendingActive = s.pendingMode != null &&
        (s.phase === "command_sent" || s.phase === "awaiting_feedback" || s.phase === "retry");
    if (pendingActive && s.pendingMode) {
        if (input.desiredMode !== s.pendingMode) {
            s = abortPending(s, "superseded", "idle");
            s.retryCount = 0;
            /** Fall through and maybe issue the new desired command. */
        }
        else if ((0, freshness_1.isCommandFeedbackConfirmed)({
            actualMode: input.actualMode,
            pendingMode: s.pendingMode,
            lastCommandAtMs: s.lastCommandAtMs,
            modeTsMs: input.modeTsMs,
        })) {
            s = (0, ownership_1.grantOrClearOwnershipAfterFeedback)({
                ...(0, types_1.clearPending)(s),
                phase: "confirmed",
                lastConfirmedMode: s.pendingMode,
                lastFeedbackAtMs: input.nowMs,
                retryCount: 0,
                lastResult: "confirmed",
            }, input.nowMs);
            return { session: s, writeMode: null };
        }
        else {
            const lastWrite = s.lastCommandAtMs ?? s.pendingSinceMs ?? input.nowMs;
            const sinceWrite = input.nowMs - lastWrite;
            if (sinceWrite < types_1.EV_FEEDBACK_SETTLE_MS || sinceWrite < types_1.EV_FEEDBACK_TIMEOUT_MS) {
                s.phase = "awaiting_feedback";
                s.lastResult = "awaiting_feedback";
                return { session: s, writeMode: null };
            }
            if (s.retryCount < types_1.EV_MAX_RETRIES && sinceWrite >= types_1.EV_RETRY_MIN_INTERVAL_MS) {
                s = {
                    ...s,
                    phase: "retry",
                    retryCount: s.retryCount + 1,
                    lastCommand: s.pendingMode,
                    lastCommandAtMs: input.nowMs,
                    lastResult: "retry",
                };
                return { session: s, writeMode: s.pendingMode };
            }
            s = abortPending(s, "failsafe", "failsafe");
            s.failsafeReason = "feedback_timeout";
            s.blockReason = "feedback_timeout";
            return { session: s, writeMode: null };
        }
    }
    if (input.desiredMode == null) {
        s.blockReason = "desired_unmappable";
        s.lastResult = "blocked";
        s.phase = s.phase === "confirmed" ? "confirmed" : "idle";
        return { session: s, writeMode: null };
    }
    if (input.actualMode === input.desiredMode) {
        s = {
            ...(0, types_1.clearPending)(s),
            phase: "confirmed",
            lastConfirmedMode: input.desiredMode,
            lastFeedbackAtMs: input.nowMs,
            retryCount: 0,
            lastResult: "already_confirmed",
        };
        return { session: s, writeMode: null };
    }
    s = {
        ...s,
        phase: "command_sent",
        pendingMode: input.desiredMode,
        pendingSinceMs: input.nowMs,
        lastCommand: input.desiredMode,
        lastCommandAtMs: input.nowMs,
        retryCount: 0,
        lastResult: "command_sent",
    };
    return { session: s, writeMode: input.desiredMode };
}
exports.stepEvExecution = stepEvExecution;

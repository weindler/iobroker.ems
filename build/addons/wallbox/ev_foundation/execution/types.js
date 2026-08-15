"use strict";
/**
 * Phase 5A EV execution types — no economic scoring.
 * Unified already decided; this layer only executes when allowed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearPending = exports.emptyEvExecutionSession = exports.EV_MAX_RETRIES = exports.EV_RETRY_MIN_INTERVAL_MS = exports.EV_FEEDBACK_TIMEOUT_MS = exports.EV_FEEDBACK_SETTLE_MS = exports.EV_FEEDBACK_CLOCK_SKEW_MS = exports.EV_MODE_STALE_AFTER_MS = exports.EV_SOURCE_STALE_AFTER_MS = exports.EV_AUTHORITY_CONFIRM_MS = exports.EV_AUTHORITY_HOLD_MS = exports.EV_EXECUTION_OWNERSHIPS = exports.EV_EXECUTION_PHASES = exports.EV_EXECUTION_AUTHORITIES = void 0;
exports.EV_EXECUTION_AUTHORITIES = ["external", "ems", "none"];
exports.EV_EXECUTION_PHASES = [
    "idle",
    "command_sent",
    "awaiting_feedback",
    "confirmed",
    "retry",
    "failsafe",
];
/** In-memory only — never reconstructed from ioBroker after restart. */
exports.EV_EXECUTION_OWNERSHIPS = ["ems", "none", "unknown"];
/** Stay external this long after the last active/planned/active_without_plan signal. */
exports.EV_AUTHORITY_HOLD_MS = 5 * 60_000;
/** Require this long of continuous inactive before External → EMS. */
exports.EV_AUTHORITY_CONFIRM_MS = 5 * 60_000;
/**
 * Source-heartbeat age (chargePower/charging/connected/offeredCurrent), not status.mode.ts.
 * status.mode may keep an old ts while the value stays valid.
 */
exports.EV_SOURCE_STALE_AFTER_MS = 10 * 60_000;
/** @deprecated Use EV_SOURCE_STALE_AFTER_MS — not a status.mode.ts limit. */
exports.EV_MODE_STALE_AFTER_MS = exports.EV_SOURCE_STALE_AFTER_MS;
/** Allow ioBroker ts to lag the local write clock slightly. */
exports.EV_FEEDBACK_CLOCK_SKEW_MS = 2_000;
/** Do not re-press the button during settle. */
exports.EV_FEEDBACK_SETTLE_MS = 15_000;
/** Feedback window after a write (incl. settle). */
exports.EV_FEEDBACK_TIMEOUT_MS = 90_000;
/** Minimum gap between retry writes. */
exports.EV_RETRY_MIN_INTERVAL_MS = 30_000;
/** Extra writes after the first command (first + 2 retries = 3 pulses max). */
exports.EV_MAX_RETRIES = 2;
function emptyEvExecutionSession() {
    return {
        phase: "idle",
        authority: "none",
        lastExternalHoldAtMs: null,
        lastInactiveSinceMs: null,
        pendingMode: null,
        pendingSinceMs: null,
        lastCommand: null,
        lastCommandAtMs: null,
        lastFeedbackAtMs: null,
        lastConfirmedMode: null,
        retryCount: 0,
        lastResult: "idle",
        failsafeReason: "",
        blockReason: "",
        desiredReason: "",
        sourceFresh: false,
        ownership: "unknown",
        ownedMode: null,
        ownedSinceMs: null,
        releaseReason: "",
        explain: "",
    };
}
exports.emptyEvExecutionSession = emptyEvExecutionSession;
function clearPending(session) {
    return {
        ...session,
        pendingMode: null,
        pendingSinceMs: null,
    };
}
exports.clearPending = clearPending;

"use strict";
/**
 * Tibber Grid Rewards braucht EVCC im steuerbaren Schnell-Modus (now).
 * Nach disconnected→connected erst stabilisieren, dann einmal now setzen.
 * Kein pauschales NOW bei normalen PV-/EMS-Ladevorgängen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateTibberNowPrepare = exports.clampTibberNowStabilizeSeconds = exports.emptyTibberNowPrepareState = exports.TIBBER_NOW_STABILIZE_MAX_S = exports.TIBBER_NOW_STABILIZE_MIN_S = exports.TIBBER_NOW_STABILIZE_DEFAULT_S = void 0;
exports.TIBBER_NOW_STABILIZE_DEFAULT_S = 180;
exports.TIBBER_NOW_STABILIZE_MIN_S = 30;
exports.TIBBER_NOW_STABILIZE_MAX_S = 900;
function emptyTibberNowPrepareState() {
    return { prevConnected: null, connectedSinceMs: null, prepareIssued: false, lastResult: "idle" };
}
exports.emptyTibberNowPrepareState = emptyTibberNowPrepareState;
function clampTibberNowStabilizeSeconds(raw) {
    if (raw == null || !Number.isFinite(raw))
        return exports.TIBBER_NOW_STABILIZE_DEFAULT_S;
    return Math.max(exports.TIBBER_NOW_STABILIZE_MIN_S, Math.min(exports.TIBBER_NOW_STABILIZE_MAX_S, Math.round(raw)));
}
exports.clampTibberNowStabilizeSeconds = clampTibberNowStabilizeSeconds;
function evaluateTibberNowPrepare(input) {
    if (!input.enabled) {
        return {
            next: emptyTibberNowPrepareState(),
            action: "idle",
            reason: "tibber_grid_rewards_disabled",
        };
    }
    if (input.connected === false) {
        return {
            next: { prevConnected: false, connectedSinceMs: null, prepareIssued: false, lastResult: "idle" },
            action: input.prev.connectedSinceMs != null ? "cancel" : "idle",
            reason: "vehicle_disconnected",
        };
    }
    if (input.connected !== true) {
        return { next: input.prev, action: "idle", reason: "connection_unknown" };
    }
    let next = { ...input.prev, prevConnected: true };
    if (input.prev.prevConnected === false) {
        next = { prevConnected: true, connectedSinceMs: input.nowMs, prepareIssued: false, lastResult: "idle" };
    }
    else if (input.prev.prevConnected == null) {
        return {
            next: { prevConnected: true, connectedSinceMs: null, prepareIssued: true, lastResult: "idle" },
            action: "idle",
            reason: "already_connected_at_start",
        };
    }
    if (next.connectedSinceMs == null || next.prepareIssued) {
        return {
            next,
            action: "idle",
            reason: next.lastResult === "feedback_failed"
                ? "feedback_failed"
                : next.prepareIssued
                    ? "already_prepared"
                    : "no_plug_edge",
        };
    }
    if (input.feedbackFailed) {
        return {
            next: { ...next, prepareIssued: true, lastResult: "feedback_failed" },
            action: "cancel",
            reason: "feedback_failed",
        };
    }
    if (input.blocked) {
        return { next, action: "wait", reason: "blocked_by_priority" };
    }
    const elapsed = input.nowMs - next.connectedSinceMs;
    if (elapsed < input.delayMs) {
        return { next, action: "wait", reason: "stabilize_wait" };
    }
    if (input.alreadyNow) {
        return {
            next: { ...next, prepareIssued: true, lastResult: "confirmed" },
            action: "idle",
            reason: "already_now",
        };
    }
    /*
     * Solange das status.mode-Feedback noch nicht `now` meldet, bleibt die Übergabe fällig.
     * Dadurch darf die vorhandene Feedback-/Retry-Maschine arbeiten; ein durch Dryrun,
     * Restore oder Fault blockierter Tick verbraucht den Plug-Edge nicht.
     */
    return { next, action: "set_now", reason: "tibber_now_after_stabilize" };
}
exports.evaluateTibberNowPrepare = evaluateTibberNowPrepare;

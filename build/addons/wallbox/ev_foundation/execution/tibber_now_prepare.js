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
    return { prevConnected: null, connectedSinceMs: null, prepareIssued: false };
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
            next: { prevConnected: false, connectedSinceMs: null, prepareIssued: false },
            action: input.prev.connectedSinceMs != null ? "cancel" : "idle",
            reason: "vehicle_disconnected",
        };
    }
    if (input.connected !== true) {
        return { next: input.prev, action: "idle", reason: "connection_unknown" };
    }
    let next = { ...input.prev, prevConnected: true };
    if (input.prev.prevConnected === false) {
        next = { prevConnected: true, connectedSinceMs: input.nowMs, prepareIssued: false };
    }
    else if (input.prev.prevConnected == null) {
        return {
            next: { prevConnected: true, connectedSinceMs: null, prepareIssued: true },
            action: "idle",
            reason: "already_connected_at_start",
        };
    }
    if (next.connectedSinceMs == null || next.prepareIssued) {
        return { next, action: "idle", reason: next.prepareIssued ? "already_prepared" : "no_plug_edge" };
    }
    if (input.blocked) {
        return { next, action: "wait", reason: "blocked_by_priority" };
    }
    if (input.plannerWantsChargeOrStop) {
        return { next, action: "wait", reason: "planner_has_priority" };
    }
    const elapsed = input.nowMs - next.connectedSinceMs;
    if (elapsed < input.delayMs) {
        return { next, action: "wait", reason: "stabilize_wait" };
    }
    if (input.alreadyNow) {
        return { next: { ...next, prepareIssued: true }, action: "idle", reason: "already_now" };
    }
    return { next: { ...next, prepareIssued: true }, action: "set_now", reason: "tibber_now_after_stabilize" };
}
exports.evaluateTibberNowPrepare = evaluateTibberNowPrepare;

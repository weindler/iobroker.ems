"use strict";
/**
 * Execution ownership: did EMS itself successfully set the active EVCC charge mode?
 *
 * Not economic ownership. Not the runtime/ownership.ts restore-on-leave-live path
 * (that grants on write, does not track pv/min/now, and is not wired to Phase 5 buttons).
 *
 * In-memory only. Restart → unknown. Never reconstruct from diagnosis states.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantOrClearOwnershipAfterFeedback = exports.dropExecutionOwnership = exports.resolveDesiredWithOwnership = exports.shouldReleaseOwnedCharge = exports.ownershipLabel = exports.isEmsOwnedChargeMode = void 0;
function isEmsOwnedChargeMode(mode) {
    return mode === "pv" || mode === "min" || mode === "now";
}
exports.isEmsOwnedChargeMode = isEmsOwnedChargeMode;
function ownershipLabel(ownership, ownedMode) {
    if (ownership === "ems" && ownedMode)
        return `ems:${ownedMode}`;
    return ownership;
}
exports.ownershipLabel = ownershipLabel;
/**
 * Release-OFF only after a positive valid plan that ends the wallbox slot,
 * and only if EMS still owns a charge mode it confirmed.
 */
function shouldReleaseOwnedCharge(input) {
    if (input.projectedDesired !== "noop")
        return false;
    if (input.projectedReason !== "no_planned_wallbox_action")
        return false;
    if (input.ownership !== "ems")
        return false;
    if (!isEmsOwnedChargeMode(input.ownedMode))
        return false;
    if (!input.planValid || !input.useDailyPlan)
        return false;
    if (input.authority !== "ems")
        return false;
    return true;
}
exports.shouldReleaseOwnedCharge = shouldReleaseOwnedCharge;
function resolveDesiredWithOwnership(input) {
    if (shouldReleaseOwnedCharge({
        projectedDesired: input.projection.desired,
        projectedReason: input.projection.reason,
        ownership: input.ownership,
        ownedMode: input.ownedMode,
        planValid: input.planValid,
        useDailyPlan: input.useDailyPlan,
        authority: input.authority,
    })) {
        return { desired: "off", reason: "release_off", action: "release_off" };
    }
    if (input.projection.desired === "off") {
        return { ...input.projection, action: "explicit_stop" };
    }
    if (input.projection.desired === "noop") {
        return { ...input.projection, action: "noop" };
    }
    return { ...input.projection, action: "execute" };
}
exports.resolveDesiredWithOwnership = resolveDesiredWithOwnership;
function dropExecutionOwnership(session, input) {
    if (session.ownership !== "ems")
        return session;
    if (input.authority !== "ems") {
        return {
            ...session,
            ownership: "none",
            ownedMode: null,
            ownedSinceMs: null,
            releaseReason: input.authority === "external" ? "external_authority" : "authority_unknown",
        };
    }
    if (!isEmsOwnedChargeMode(session.ownedMode) || input.actualMode == null)
        return session;
    if (input.actualMode === session.ownedMode)
        return session;
    const pendingOurCommand = session.pendingMode != null &&
        (session.phase === "command_sent" || session.phase === "awaiting_feedback" || session.phase === "retry");
    /** Our own command is landing — do not treat that as a foreign takeover. */
    if (pendingOurCommand && input.actualMode === session.pendingMode)
        return session;
    return {
        ...session,
        ownership: "none",
        ownedMode: null,
        ownedSinceMs: null,
        releaseReason: "actual_mode_changed_externally",
        pendingMode: pendingOurCommand ? null : session.pendingMode,
        pendingSinceMs: pendingOurCommand ? null : session.pendingSinceMs,
        phase: pendingOurCommand ? "idle" : session.phase,
        lastResult: pendingOurCommand ? "ownership_lost" : session.lastResult,
    };
}
exports.dropExecutionOwnership = dropExecutionOwnership;
function grantOrClearOwnershipAfterFeedback(session, nowMs) {
    if (session.lastResult !== "confirmed")
        return session;
    const mode = session.lastConfirmedMode;
    if (isEmsOwnedChargeMode(mode)) {
        return {
            ...session,
            ownership: "ems",
            ownedMode: mode,
            ownedSinceMs: session.ownedMode === mode && session.ownedSinceMs != null ? session.ownedSinceMs : nowMs,
            releaseReason: "",
        };
    }
    if (mode === "off") {
        return {
            ...session,
            ownership: "none",
            ownedMode: null,
            ownedSinceMs: null,
            releaseReason: session.releaseReason || "released_off",
        };
    }
    return session;
}
exports.grantOrClearOwnershipAfterFeedback = grantOrClearOwnershipAfterFeedback;

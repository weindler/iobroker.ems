"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_3E_PUBLISH_DEFAULTS = exports.resolvePlannerPublishTarget = void 0;
/**
 * Resolve publish target. Canonical is never reachable in Phase 3E:
 * requires productiveTakeoverMode + open releaseGate + non-simulation + all validations.
 * A single boolean cannot open the gate.
 */
function resolvePlannerPublishTarget(input) {
    if (input.shuttingDown) {
        return { target: "none", allowed: false, reason: "shutting_down" };
    }
    if (input.requestedTarget === "none") {
        return { target: "none", allowed: true, reason: "none_requested" };
    }
    if (input.requestedTarget === "candidate") {
        if (!input.candidateValid) {
            return { target: "none", allowed: false, reason: "candidate_invalid" };
        }
        if (!input.generationMatches || !input.inputRevisionMatches) {
            return { target: "none", allowed: false, reason: "revision_mismatch" };
        }
        return { target: "candidate", allowed: true, reason: "candidate_ok" };
    }
    // requestedTarget === "canonical"
    const canonicalAllowed = input.productiveTakeoverMode === true &&
        input.releaseGate === "open" &&
        input.jobMode !== "simulation" &&
        input.jobMode !== "explain" &&
        input.candidateValid &&
        input.generationMatches &&
        input.inputRevisionMatches &&
        !input.shuttingDown;
    if (!canonicalAllowed) {
        return {
            target: "blocked_canonical",
            allowed: false,
            reason: "canonical_gate_closed",
        };
    }
    // Unreachable in Phase 3E tests / production — kept for future multi-gate takeover.
    return { target: "blocked_canonical", allowed: false, reason: "canonical_not_implemented_phase_3e" };
}
exports.resolvePlannerPublishTarget = resolvePlannerPublishTarget;
/** Phase 3E default: always closed release gate, never productive takeover. */
exports.PHASE_3E_PUBLISH_DEFAULTS = {
    releaseGate: "closed",
    productiveTakeoverMode: false,
    requestedTarget: "candidate",
};

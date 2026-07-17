/**
 * Planner publish target — hard gate for Phase 3E.
 * `canonical` exists in the type system but is unreachable without multiple independent conditions
 * that Phase 3E never satisfies (simulation mode, closed release gate).
 */
export type PlannerPublishTarget = "none" | "candidate" | "canonical";

export type PlannerPublishReleaseGate = "closed" | "open";

export interface PlannerPublishDecisionInput {
	/** Configured / requested target. */
	requestedTarget: PlannerPublishTarget;
	/** Worker job mode from request. */
	jobMode: "simulation" | "publish" | "explain" | string;
	/** Explicit multi-factor release gate — Phase 3E always closed. */
	releaseGate: PlannerPublishReleaseGate;
	/** Validated worker candidate available. */
	candidateValid: boolean;
	/** Generation matches active coordinator generation. */
	generationMatches: boolean;
	/** Input revision matches. */
	inputRevisionMatches: boolean;
	/** Adapter shutting down. */
	shuttingDown: boolean;
	/**
	 * Explicit productive runtime mode that would allow canonical publish.
	 * Phase 3E has no such mode — always false.
	 */
	productiveTakeoverMode: boolean;
}

export interface PlannerPublishDecision {
	target: Exclude<PlannerPublishTarget, "canonical"> | "blocked_canonical";
	allowed: boolean;
	reason: string;
}

/**
 * Resolve publish target. Canonical is never reachable in Phase 3E:
 * requires productiveTakeoverMode + open releaseGate + non-simulation + all validations.
 * A single boolean cannot open the gate.
 */
export function resolvePlannerPublishTarget(input: PlannerPublishDecisionInput): PlannerPublishDecision {
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
	const canonicalAllowed =
		input.productiveTakeoverMode === true &&
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

/** Phase 3E default: always closed release gate, never productive takeover. */
export const PHASE_3E_PUBLISH_DEFAULTS = {
	releaseGate: "closed" as const,
	productiveTakeoverMode: false as const,
	requestedTarget: "candidate" as const,
};

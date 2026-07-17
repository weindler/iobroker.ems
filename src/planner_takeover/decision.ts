import type { PlannerPublishTarget } from "../planner_publish/policy";
import { tryMintCanonicalPublishPermitFromShadow } from "../planner_publish/permit";
import type { PlannerTakeoverDecision, PlannerTakeoverEvidence, PlannerTakeoverState } from "./types";

/**
 * Simulated takeover decision — never opens canonical publish in Phase 3F.
 * Even when evaluationState is ready and requestedTarget is canonical.
 */
export function resolvePlannerTakeoverDecision(input: {
	requestedTarget: PlannerPublishTarget;
	evaluationState: PlannerTakeoverState;
	evidence?: PlannerTakeoverEvidence | null;
	inputRevision?: string | null;
	candidateRevision?: string | null;
	authoritativeRevision?: string | null;
	shuttingDown?: boolean;
}): PlannerTakeoverDecision {
	const permit = tryMintCanonicalPublishPermitFromShadow({
		evaluationState: input.evaluationState,
		requestedTarget: input.requestedTarget,
		evidence: input.evidence,
	});
	void permit; // always null in Phase 3F

	const blockReasons: string[] = [];
	if (input.shuttingDown) blockReasons.push("shutdown");
	if (input.evaluationState === "not_evaluated") blockReasons.push("evaluation_disabled");
	if (input.evaluationState === "blocked") {
		blockReasons.push(input.evidence?.lastBlockReason ?? "semantic_mismatch");
	}
	if (input.evaluationState === "collecting") {
		blockReasons.push(input.evidence?.lastBlockReason ?? "insufficient_runs");
	}
	if (input.requestedTarget === "canonical") {
		blockReasons.push("canonical_gate_closed");
	}

	const wouldBeEligible =
		input.evaluationState === "ready" &&
		!input.shuttingDown &&
		input.requestedTarget !== "none";

	let resolvedTarget: "none" | "candidate" = "none";
	if (input.requestedTarget === "candidate" && wouldBeEligible) {
		resolvedTarget = "candidate";
	} else if (input.requestedTarget === "canonical") {
		// Phase 3F: never canonical — degrade to candidate only as diagnostic resolved target
		// when ready, else none. Still canonicalAllowed=false.
		resolvedTarget = wouldBeEligible ? "candidate" : "none";
	} else if (input.requestedTarget === "none") {
		resolvedTarget = "none";
	}

	return {
		requestedTarget: input.requestedTarget,
		resolvedTarget,
		canonicalAllowed: false,
		evaluationState: input.evaluationState,
		wouldBeEligible,
		blockReasons,
		inputRevision: input.inputRevision ?? null,
		candidateRevision: input.candidateRevision ?? null,
		authoritativeRevision: input.authoritativeRevision ?? null,
	};
}

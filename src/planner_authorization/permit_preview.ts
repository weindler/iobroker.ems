import type { PlannerTakeoverAuthorizationGrant } from "./grant";
import { grantExpired, isAuthorizationGrant } from "./grant";
import { tryMintProductiveActivationCapability } from "./activation";
import { tryMintCanonicalPublishPermitFromShadow, type CanonicalPublishPermit } from "../planner_publish/permit";
import type { CanonicalPermitMintPreview, PlannerAuthorizationState } from "./types";

export interface PermitMintPreviewInput {
	authorizationState: PlannerAuthorizationState;
	grant: PlannerTakeoverAuthorizationGrant | null;
	nowMs: number;
	evidenceReady: boolean;
	revisionMatch: boolean;
	executionModeDryrun: boolean;
	releaseGateClosed: boolean;
	/** Always false in Phase 3G — no producer. */
	productiveActivationPresent?: boolean;
}

/**
 * Diagnostic permit-mint preview. Never mints a CanonicalPublishPermit.
 * Even with a valid grant, ends at activation_blocked when capability is missing.
 */
export function evaluateCanonicalPermitMintPreview(input: PermitMintPreviewInput): CanonicalPermitMintPreview {
	const grantValid =
		input.grant != null &&
		isAuthorizationGrant(input.grant) &&
		!grantExpired(input.grant, input.nowMs);

	const activation = tryMintProductiveActivationCapability({
		grantPresent: grantValid,
		evidenceReady: input.evidenceReady,
	});
	const productiveActivationCapabilityPresent = false as const;
	void activation; // always null in Phase 3G

	const permit: CanonicalPublishPermit | null = tryMintCanonicalPublishPermitFromShadow({
		evaluationState: input.evidenceReady ? "ready" : "not_evaluated",
		requestedTarget: "canonical",
		productiveTakeoverMode: false,
	});
	void permit; // always null

	const blockReasons: string[] = [];
	if (!grantValid) blockReasons.push("authorization_grant_invalid");
	else blockReasons.push("activation_capability_missing");
	if (!input.evidenceReady) blockReasons.push("evidence_not_ready");
	if (!input.revisionMatch) blockReasons.push("revision_mismatch");
	if (!input.executionModeDryrun) blockReasons.push("execution_mode_not_dryrun");
	if (input.releaseGateClosed) blockReasons.push("release_gate_closed");
	if (grantValid && !blockReasons.includes("activation_capability_missing")) {
		blockReasons.push("activation_capability_missing");
	}

	let authorizationState: CanonicalPermitMintPreview["authorizationState"] = "not_requested";
	if (input.authorizationState === "ineligible") authorizationState = "ineligible";
	else if (input.authorizationState === "prepared") authorizationState = "prepared";
	else if (
		input.authorizationState === "confirmed" ||
		input.authorizationState === "activation_blocked"
	) {
		authorizationState = "activation_blocked";
	}

	return {
		authorizationState,
		authorizationGrantValid: grantValid,
		productiveActivationCapabilityPresent,
		wouldPassRevisionChecks: input.revisionMatch,
		wouldPassEvidenceChecks: input.evidenceReady,
		wouldPassExecutionModeChecks: input.executionModeDryrun,
		wouldPassPublishChecks: !input.releaseGateClosed,
		permitMinted: false,
		canonicalAllowed: false,
		primaryBlockReason: blockReasons[0] ?? null,
		blockReasonCount: blockReasons.length,
	};
}

/**
 * Phase 3G mint attempt — always returns null.
 * Requires both grant AND ProductiveTakeoverActivationCapability (unavailable).
 */
export function tryMintCanonicalPublishPermitWithGrant(_input: {
	grant: PlannerTakeoverAuthorizationGrant | null;
	nowMs: number;
}): CanonicalPublishPermit | null {
	const cap = tryMintProductiveActivationCapability({ grantPresent: _input.grant != null });
	if (!cap) return null;
	// Unreachable in Phase 3G — kept for future multi-factor mint.
	return null;
}

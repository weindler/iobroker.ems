import type { TAKEOVER_CHALLENGE_SCHEMA_VERSION } from "./constants";

export type PlannerAuthorizationState =
	| "disabled"
	| "idle"
	| "ineligible"
	| "prepared"
	| "confirmed"
	| "activation_blocked"
	| "expired"
	| "cancelled"
	| "invalidated"
	| "error";

export type PlannerAuthorizationEligibilityCode =
	| "authorization_disabled"
	| "runtime_mode_not_auto"
	| "evaluation_not_observe"
	| "evidence_not_ready"
	| "evidence_stale"
	| "evidence_schema_mismatch"
	| "evidence_policy_mismatch"
	| "last_run_not_matched"
	| "newer_mismatch"
	| "newer_failure"
	| "missing_authoritative_revision"
	| "missing_candidate_revision"
	| "missing_input_revision"
	| "generation_mismatch"
	| "horizon_mismatch"
	| "candidate_invalid"
	| "authoritative_publish_failed"
	| "planner_job_active"
	| "pending_rerun"
	| "execution_mode_not_dryrun"
	| "restore_barrier_active"
	| "operation_lock_active"
	| "adapter_not_ready"
	| "shutdown"
	| "challenge_active"
	| "grant_active"
	| "release_gate_closed"
	| "activation_capability_missing";

export interface PlannerTakeoverChallenge {
	schemaVersion: typeof TAKEOVER_CHALLENGE_SCHEMA_VERSION;
	challengeId: string;
	adapterInstance: string;
	sessionId: string;
	createdAt: string;
	expiresAt: string;
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	evidencePolicyRevision: string;
	planningHorizonStart: string;
	planningHorizonEnd: string;
	slotDurationMinutes: number;
	executionMode: "dryrun";
	consumed: boolean;
	confirmFailures: number;
	plannerContractVersion: number;
	snapshotSchemaVersion: number;
	publishPolicyRevision: string;
}

export interface PlannerAuthorizationEligibilityResult {
	eligible: boolean;
	codes: PlannerAuthorizationEligibilityCode[];
	primaryCode: PlannerAuthorizationEligibilityCode | null;
	/** Inclusive OR diagnostic — true when full evidence or dryrun pilot is ready. */
	takeoverReady: boolean;
	fullEvidenceReady: boolean;
	dryrunPilotReady: boolean;
}

export interface CanonicalPermitMintPreview {
	authorizationState:
		| "not_requested"
		| "ineligible"
		| "prepared"
		| "confirmed"
		| "activation_blocked";
	authorizationGrantValid: boolean;
	productiveActivationCapabilityPresent: false;
	wouldPassRevisionChecks: boolean;
	wouldPassEvidenceChecks: boolean;
	wouldPassExecutionModeChecks: boolean;
	wouldPassPublishChecks: boolean;
	permitMinted: false;
	canonicalAllowed: false;
	primaryBlockReason: string | null;
	blockReasonCount: number;
}

export interface PlannerAuthorizationAuditEntry {
	timestamp: string;
	eventCode: string;
	resultCode: string;
	challengeIdShort: string | null;
	grantIdShort: string | null;
	generation: number | null;
	inputRevisionShort: string | null;
	candidateRevisionShort: string | null;
	authoritativeRevisionShort: string | null;
	evidenceRevisionShort: string | null;
	sessionIdShort: string;
}

export interface PlannerAuthorizationPublicStatus {
	configuredMode: "disabled" | "manual_prepare";
	effectiveMode: "disabled" | "manual_prepare";
	state: PlannerAuthorizationState;
	eligible: boolean;
	primaryBlockReason: string | null;
	blockReasonCount: number;
	challengeId: string | null;
	challengeCreatedAt: string | null;
	challengeExpiresAt: string | null;
	confirmFailures: number;
	grantActive: boolean;
	grantCreatedAt: string | null;
	grantExpiresAt: string | null;
	revisionMatch: boolean;
	activationCapabilityPresent: false;
	permitMinted: false;
	canonicalAllowed: false;
	lastEventCode: string | null;
	lastErrorCode: string | null;
}

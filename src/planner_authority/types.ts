import type { ACTIVE_AUTHORITY_SCHEMA_VERSION } from "./constants";
import type { PlannerRequestedAuthority } from "../planner_config/authoritative_source";

/**
 * Effective authority resolved at runtime:
 * - legacy: legacy operator projection is authoritative.
 * - worker_pending: worker_dryrun configured but not yet activated (no lease).
 * - worker_dryrun: worker plan is authoritative (lease active), dryrun only.
 * - legacy_fallback: worker revoked after safety/error; session latch blocks auto-reactivation.
 */
export type PlannerEffectiveAuthority =
	| "legacy"
	| "worker_pending"
	| "worker_dryrun"
	| "legacy_fallback";

export type PlannerDryrunPilotState = "ready" | "not_ready" | "blocked";

export type PlannerDryrunPilotCode =
	| "evaluation_disabled"
	| "evidence_missing"
	| "insufficient_runs"
	| "insufficient_consecutive_matches"
	| "insufficient_observation_time"
	| "insufficient_slot_transitions"
	| "mismatches_present"
	| "failures_present"
	| "last_run_stale"
	| "policy_mismatch"
	| "identity_mismatch";

export interface PlannerDryrunPilotReadiness {
	state: PlannerDryrunPilotState;
	codes: PlannerDryrunPilotCode[];
	primaryCode: PlannerDryrunPilotCode | null;
	eligibleRuns: number;
	consecutiveMatches: number;
	observationMs: number | null;
	slotTransitions: number;
	mismatches: number;
	failures: number;
	lastRunAgeMs: number | null;
}

/** Worker-dryrun authority lease — WeakSet-branded, never persisted, never sent to worker. */
export interface WorkerDryrunAuthorityLease {
	readonly leaseId: string;
	readonly adapterInstance: string;
	readonly sessionId: string;
	readonly grantId: string;
	readonly generation: number;
	readonly inputRevision: string;
	readonly candidateRevision: string;
	readonly authoritativeRevision: string;
	readonly evidenceRevision: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
}

/** On-disk pointer selecting the active authoritative plan view. */
export interface ActivePlannerAuthorityPointer {
	schemaVersion: typeof ACTIVE_AUTHORITY_SCHEMA_VERSION;
	source: PlannerRequestedAuthority;
	generation: number;
	/** Absolute path to worker canonical plan, or null for legacy. */
	planPath: string | null;
	planRevision: string | null;
	updatedAt: string;
	sessionId: string;
}

export type AuthoritativeViewQuality = "valid" | "stale" | "missing" | "invalid";

export interface AuthoritativePlannerSlot {
	slotStart: string;
	slotEnd: string;
	allocations: Array<{
		contributionId: string;
		powerW: number | null;
		energyKwh: number | null;
		status: string;
	}>;
}

export interface AuthoritativePlannerView {
	source: PlannerRequestedAuthority;
	quality: AuthoritativeViewQuality;
	generation: number | null;
	planRevision: string | null;
	currentSlot: AuthoritativePlannerSlot | null;
	nextSlot: AuthoritativePlannerSlot | null;
	loadedAt: string;
}

export interface PlannerAuthorityPublicStatus {
	configuredSource: PlannerRequestedAuthority;
	effectiveAuthority: PlannerEffectiveAuthority;
	workerAuthoritative: boolean;
	/** True only while a valid worker-dryrun lease is active — never means live writes. */
	canonicalAllowed: boolean;
	dryrunPilotState: PlannerDryrunPilotState;
	dryrunPilotPrimaryCode: PlannerDryrunPilotCode | null;
	leaseActive: boolean;
	leaseExpiresAt: string | null;
	fallbackLatched: boolean;
	fallbackReason: string | null;
	viewQuality: AuthoritativeViewQuality | null;
	planRevision: string | null;
	generation: number | null;
	lastEventCode: string | null;
	lastErrorCode: string | null;
}

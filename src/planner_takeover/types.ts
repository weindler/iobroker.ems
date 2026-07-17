import type { PlannerPublishTarget } from "../planner_publish/policy";
import type { TAKEOVER_EVIDENCE_SCHEMA_VERSION } from "./constants";

export type PlannerTakeoverState = "not_evaluated" | "collecting" | "ready" | "blocked";

export type PlannerTakeoverBlockReason =
	| "evaluation_disabled"
	| "runtime_mode_not_auto"
	| "insufficient_runs"
	| "insufficient_observation_time"
	| "insufficient_distinct_days"
	| "no_slot_transition"
	| "no_day_transition"
	| "input_not_comparable"
	| "candidate_invalid"
	| "candidate_stale"
	| "worker_timeout"
	| "worker_crash"
	| "worker_failed"
	| "authoritative_failed"
	| "semantic_mismatch"
	| "generation_mismatch"
	| "input_revision_mismatch"
	| "schema_mismatch"
	| "shutdown"
	| "stale_eligible_run"
	| "policy_reset"
	| null;

export interface PlannerDualRunIdentity {
	dualRunId: string;
	generation: number;
	triggerClass: string;
	triggerReason: string;
	inputRevision: string;
	snapshotSchemaVersion: number;
	planningHorizonStart: string;
	planningHorizonEnd: string;
	slotDurationMinutes: number;
	configRevision?: string;
	plannerContractVersion?: number;
	force: boolean;
}

export interface NormalizedPlannerHorizon {
	start: string;
	end: string;
	slotMinutes: number;
}

export interface NormalizedPlannerSlot {
	start: string;
	end: string;
	pvPowerW: number | null;
	houseLoadPowerW: number | null;
	fixedBalancePowerW: number | null;
	gridPriceCtPerKwh: number | null;
	gridImportAllowed: boolean | null;
	gridMaxImportPowerW: number | null;
}

export interface NormalizedPlannerAllocation {
	contributionId: string;
	slotStart: string;
	slotEnd: string;
	powerW: number | null;
	energyKwh: number | null;
	status: string;
}

export interface NormalizedPlannerTotals {
	flexibleAllocatedEnergyKwh: number | null;
	flexibleUnallocatedEnergyKwh: number | null;
	pvForecastEnergyKwh: number | null;
	fixedHouseLoadEnergyKwh: number | null;
}

export interface NormalizedPlannerPlan {
	schemaVersion: number;
	horizon: NormalizedPlannerHorizon;
	slots: NormalizedPlannerSlot[];
	allocations: NormalizedPlannerAllocation[];
	totals: NormalizedPlannerTotals;
	constraintsRevision: string;
	semanticRevision: string;
	validationStatus: string;
	forecastStatus: string;
	dailyStatus: string;
	qualityCodes: string[];
}

export interface PlannerTakeoverEvidence {
	schemaVersion: typeof TAKEOVER_EVIDENCE_SCHEMA_VERSION;
	state: PlannerTakeoverState;
	eligibleRuns: number;
	matchedRuns: number;
	mismatchedRuns: number;
	failedRuns: number;
	incomparableRuns: number;
	consecutiveMatches: number;
	observationStartedAt: string | null;
	lastEligibleRunAt: string | null;
	lastMatchAt: string | null;
	lastMismatchAt: string | null;
	lastFailureAt: string | null;
	observedDistinctUtcDays: number;
	observedSlotTransitions: number;
	observedDayTransitions: number;
	lastBlockReason: PlannerTakeoverBlockReason;
	firstMismatchDomain: string | null;
	evidenceRevision: string;
	policyFingerprint: string;
	plannerSchemaVersion: number;
	lastAuthoritativeRevision: string | null;
	lastCandidateRevision: string | null;
	lastHorizonStart: string | null;
	lastHorizonEnd: string | null;
	observedUtcDayKeys: string[];
}

export interface PlannerTakeoverDecision {
	requestedTarget: PlannerPublishTarget;
	resolvedTarget: "none" | "candidate";
	canonicalAllowed: false;
	evaluationState: PlannerTakeoverState;
	wouldBeEligible: boolean;
	blockReasons: string[];
	inputRevision: string | null;
	candidateRevision: string | null;
	authoritativeRevision: string | null;
}

export type DualRunCompareStatus =
	| "matched"
	| "mismatch"
	| "not_comparable"
	| "validation_failed"
	| "authoritative_failed"
	| "worker_failed"
	| "aborted";

export interface DualRunCompareResult {
	status: DualRunCompareStatus;
	mismatchCount: number;
	mismatchedSlotCount: number;
	firstMismatchDomain?: string;
	firstMismatchPath?: string;
	authoritativeRevision?: string;
	candidateRevision?: string;
}

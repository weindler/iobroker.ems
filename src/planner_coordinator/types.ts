import type { PlannerJobRunResult } from "../planner_job/lifecycle";
import type { PlannerPreparedInput } from "../planner_preparation/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import type { PlannerWorkerResult } from "../planner_contracts/types";
import type { PlannerShadowComparisonResult, PlannerShadowComparisonStatus } from "../planner_shadow/types";
import type { PlannerCandidateComparisonStatus } from "../planner_shadow/candidate_compare";

// Allow Phase-3E candidate statuses on the same compact field.
export type PlannerCoordinatorComparisonStatus =
	| PlannerShadowComparisonStatus
	| PlannerCandidateComparisonStatus;

export type PlannerCoordinatorState =
	| "disabled"
	| "idle"
	| "building_snapshot"
	| "starting_worker"
	| "worker_running"
	| "validating_output"
	| "succeeded"
	| "failed"
	| "stopping"
	| "stopped";

export type PlannerTriggerReason =
	| "manual"
	| "relevant_change"
	| "scheduled"
	| "ai_request"
	| "startup_recovery"
	| "test";

export interface PlannerTriggerRequest {
	reason: PlannerTriggerReason;
	requestedAt: string;
	correlationId?: string;
	force?: boolean;
}

export interface PlannerCoordinatorStatus {
	state: PlannerCoordinatorState;
	enabled: boolean;
	generation: number;
	activeJobId?: string;
	activeReason?: PlannerTriggerReason;
	rerunPending: boolean;
	pendingReason?: PlannerTriggerReason;
	lastInputRevision?: string;
	lastPreparationRevision?: string;
	lastStartedAt?: string;
	lastFinishedAt?: string;
	lastDurationMs?: number;
	lastResult?: "success" | "failed" | "skipped";
	lastSkipReason?: string;
	lastErrorCode?: string;
	/** High-level failure stage (import/snapshot/worker/...). */
	lastErrorStage?: string;
	/** Compact safe error detail for diagnostics (no stack). */
	lastErrorDetail?: string;
	lastTriggerReason?: PlannerTriggerReason;
	comparisonStatus?: PlannerCoordinatorComparisonStatus;
	comparisonReferenceRevision?: string;
	comparisonWorkerRevision?: string;
	comparisonMismatchCount?: number;
	comparisonFirstMismatch?: string;
	comparisonFirstDomain?: string;
	comparisonMismatchedSlots?: number;
	candidateRevision?: string;
	candidateValidation?: string;
}

export type PlannerCoordinatorStatusListener = (status: PlannerCoordinatorStatus) => void;

export interface PlannerCoordinatorRunOutcome {
	result: "success" | "failed" | "skipped" | "coalesced";
	skipReason?: string;
	errorCode?: string;
	jobId?: string;
	generation?: number;
	inputRevision?: string;
	preparationRevision?: string;
	durationMs?: number;
}

export interface PlannerWorkerRunResult extends PlannerJobRunResult {
	result?: PlannerWorkerResult | null;
}

export interface PlannerOnDemandCoordinatorDependencies {
	buildSnapshot(): Promise<PlannerInputSnapshot>;
	/**
	 * Compute the authoritative dual-run projection exactly once for this job.
	 * Must not be repeated for compare/evidence; result is reused via store.
	 */
	runAuthoritativeProjection?(input: {
		snapshot: PlannerInputSnapshot;
		generation: number;
		jobId: string;
	}): Promise<{ ok: boolean; errorCode?: string } | void> | { ok: boolean; errorCode?: string } | void;
	runWorkerJob(input: {
		jobId: string;
		generation: number;
		snapshot: PlannerInputSnapshot;
		triggerReason: PlannerTriggerReason;
		requestedAt: string;
		timeoutMs?: number;
	}): Promise<PlannerWorkerRunResult>;
	readPreparedOutput(jobId: string, expectedInputRevision: string): Promise<PlannerPreparedInput>;
	readWorkerResult(jobId: string): Promise<PlannerWorkerResult | null>;
	cleanupJob(jobId: string): Promise<void>;
	isWorkerRunning(): boolean;
	shutdownWorker(): Promise<void>;
	now(): Date;
	compareShadowOutput?: (input: {
		snapshot: PlannerInputSnapshot;
		prepared: PlannerPreparedInput;
		jobId?: string;
	}) => PlannerShadowComparisonResult | import("../planner_shadow/candidate_compare").PlannerCandidateComparisonResult;
	/**
	 * Optional Phase-3F dual-run / takeover evidence hook.
	 * Must never throw into the coordinator — callers wrap errors.
	 * Must never delay or affect authoritative planner publish.
	 */
	onDualRunOutcome?: (event: {
		result: "success" | "failed";
		trigger: PlannerTriggerRequest;
		generation: number;
		jobId?: string;
		snapshot: PlannerInputSnapshot;
		comparison?:
			| PlannerShadowComparisonResult
			| import("../planner_shadow/candidate_compare").PlannerCandidateComparisonResult;
		errorCode?: string;
		shuttingDown: boolean;
		/** When set, authoritative side failed or publish seal failed — never positive match. */
		authoritativeFailed?: boolean;
		authoritativeErrorCode?: string;
	}) => Promise<void> | void;
}

export interface PlannerOnDemandCoordinatorOptions {
	enabled?: boolean;
	/** Optional adapter logger for staged failure diagnostics. */
	log?: Pick<ioBroker.Logger, "error" | "warn" | "info" | "debug">;
}

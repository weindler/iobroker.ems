import type { PlannerJobRunResult } from "../planner_job/lifecycle";
import type { PlannerPreparedInput } from "../planner_preparation/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import type { PlannerWorkerResult } from "../planner_contracts/types";
import type { PlannerShadowComparisonResult, PlannerShadowComparisonStatus } from "../planner_shadow/types";

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
	lastTriggerReason?: PlannerTriggerReason;
	comparisonStatus?: PlannerShadowComparisonStatus;
	comparisonReferenceRevision?: string;
	comparisonWorkerRevision?: string;
	comparisonMismatchCount?: number;
	comparisonFirstMismatch?: string;
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
	}) => PlannerShadowComparisonResult;
}

export interface PlannerOnDemandCoordinatorOptions {
	enabled?: boolean;
}

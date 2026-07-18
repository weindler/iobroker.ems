import { PlannerInputValidationError } from "../planner_preparation/types";
import type { PlannerShadowComparisonResult } from "../planner_shadow/types";
import { classifyCoordinatorError, PlannerCoordinatorStageError } from "./errors";
import { copyCoordinatorStatus, createInitialCoordinatorStatus } from "./status";
import { mergeTriggerRequests } from "./trigger";
import type {
	PlannerCoordinatorRunOutcome,
	PlannerCoordinatorState,
	PlannerCoordinatorStatus,
	PlannerCoordinatorStatusListener,
	PlannerOnDemandCoordinatorDependencies,
	PlannerOnDemandCoordinatorOptions,
	PlannerTriggerReason,
	PlannerTriggerRequest,
} from "./types";

export class PlannerOnDemandCoordinator {
	private status: PlannerCoordinatorStatus;
	private runInProgress = false;
	private runSlotTaken = false;
	private stopping = false;
	private stopped = false;
	private lastSuccessfulInputRevision: string | undefined;
	private lastSuccessfulPreparationRevision: string | undefined;
	private lastRunFailed = false;
	private activeJobId: string | undefined;
	private pendingTrigger: PlannerTriggerRequest | undefined;
	private queuePromise: Promise<void> = Promise.resolve();
	private readonly listeners = new Set<PlannerCoordinatorStatusListener>();
	private readonly log: PlannerOnDemandCoordinatorOptions["log"];

	constructor(
		private readonly deps: PlannerOnDemandCoordinatorDependencies,
		options: PlannerOnDemandCoordinatorOptions = {},
	) {
		const enabled = options.enabled ?? false;
		this.status = createInitialCoordinatorStatus(enabled);
		this.log = options.log;
	}

	enable(): void {
		if (this.stopped) {
			return;
		}
		this.status.enabled = true;
		if (this.status.state === "disabled") {
			this.setState("idle");
		} else {
			this.notifyListeners();
		}
	}

	async disable(options: { interruptActive?: boolean } = {}): Promise<void> {
		this.status.enabled = false;
		this.status.rerunPending = false;
		this.status.pendingReason = undefined;
		this.pendingTrigger = undefined;
		if (options.interruptActive && this.runInProgress) {
			await this.deps.shutdownWorker().catch(() => undefined);
		}
		if (!this.runInProgress && !this.stopping && !this.stopped) {
			this.setState("disabled");
		}
		this.notifyListeners();
	}

	subscribeStatus(listener: PlannerCoordinatorStatusListener): () => void {
		this.listeners.add(listener);
		listener(copyCoordinatorStatus(this.status));
		return () => {
			this.listeners.delete(listener);
		};
	}

	getStatus(): PlannerCoordinatorStatus {
		return copyCoordinatorStatus(this.status);
	}

	hasActiveJobReference(): boolean {
		return this.activeJobId !== undefined;
	}

	/** Test hook: coordinator never retains full snapshot or prepared payloads. */
	getRetainedPayloadBytes(): number {
		return 0;
	}

	async request(trigger: PlannerTriggerRequest): Promise<PlannerCoordinatorRunOutcome> {
		if (this.stopped) {
			return { result: "failed", errorCode: "coordinator_stopping" };
		}
		if (this.stopping) {
			return { result: "failed", errorCode: "coordinator_stopping" };
		}
		if (!this.status.enabled) {
			this.status.lastResult = "skipped";
			this.status.lastSkipReason = "planner_disabled";
			this.status.lastTriggerReason = trigger.reason;
			this.notifyListeners();
			return { result: "skipped", skipReason: "planner_disabled" };
		}

		this.status.lastTriggerReason = trigger.reason;

		if (this.runSlotTaken || this.runInProgress) {
			this.status.rerunPending = true;
			this.pendingTrigger = mergeTriggerRequests(this.pendingTrigger, trigger);
			this.status.pendingReason = this.pendingTrigger.reason;
			this.notifyListeners();
			return { result: "coalesced" };
		}

		const outcome = await this.enqueueRun(trigger);
		return outcome;
	}

	async stop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		this.stopping = true;
		this.status.rerunPending = false;
		this.status.pendingReason = undefined;
		this.pendingTrigger = undefined;
		this.setState("stopping");
		await this.deps.shutdownWorker().catch(() => undefined);
		await this.queuePromise.catch(() => undefined);
		this.activeJobId = undefined;
		this.status.activeJobId = undefined;
		this.stopped = true;
		this.stopping = false;
		this.status.enabled = false;
		this.setState("stopped");
	}

	private enqueueRun(trigger: PlannerTriggerRequest): Promise<PlannerCoordinatorRunOutcome> {
		this.runSlotTaken = true;
		let outcome!: PlannerCoordinatorRunOutcome;
		this.queuePromise = this.queuePromise
			.then(async () => {
				outcome = await this.runWithOptionalFollowUp(trigger);
			})
			.finally(() => {
				this.runSlotTaken = false;
			});
		return this.queuePromise.then(() => outcome);
	}

	private async runWithOptionalFollowUp(
		trigger: PlannerTriggerRequest,
	): Promise<PlannerCoordinatorRunOutcome> {
		let lastOutcome = await this.runOnce(trigger);
		while (this.status.rerunPending && !this.stopping && !this.stopped && this.status.enabled) {
			this.status.rerunPending = false;
			const followUp =
				this.pendingTrigger ??
				({
					reason: trigger.reason,
					requestedAt: this.deps.now().toISOString(),
					force: trigger.force,
				} satisfies PlannerTriggerRequest);
			this.pendingTrigger = undefined;
			this.status.pendingReason = undefined;
			lastOutcome = await this.runOnce(followUp);
		}
		return lastOutcome;
	}

	private async runOnce(trigger: PlannerTriggerRequest): Promise<PlannerCoordinatorRunOutcome> {
		if (this.stopping || this.stopped || !this.status.enabled) {
			return { result: "failed", errorCode: "coordinator_stopping" };
		}

		this.runInProgress = true;
		this.status.activeReason = trigger.reason;
		const startedAt = this.deps.now();
		this.status.lastStartedAt = startedAt.toISOString();
		let jobId: string | undefined;
		let generation = 0;
		let inputRevision: string | undefined;
		let snapshotForOutcome: import("../planner_snapshot/types").PlannerInputSnapshot | undefined;
		let stageHint: import("./errors").PlannerCoordinatorErrorStage | undefined;

		try {
			this.setState("building_snapshot");
			stageHint = "snapshot_build_failed";
			const snapshot = await this.deps.buildSnapshot();
			snapshotForOutcome = snapshot;
			inputRevision = snapshot.inputRevision;
			stageHint = undefined;

			if (this.shouldSkipUnchangedInput(trigger, inputRevision)) {
				const finishedAt = this.deps.now();
				this.status.lastResult = "skipped";
				this.status.lastSkipReason = "unchanged_input";
				this.status.lastFinishedAt = finishedAt.toISOString();
				this.status.lastDurationMs = finishedAt.getTime() - startedAt.getTime();
				this.setState("idle");
				return {
					result: "skipped",
					skipReason: "unchanged_input",
					inputRevision,
					preparationRevision: this.lastSuccessfulPreparationRevision,
				};
			}

			generation = ++this.status.generation;
			jobId = `planner-${generation}-${startedAt.getTime()}`;
			this.activeJobId = jobId;
			this.status.activeJobId = jobId;

			let authoritativeFailed = false;
			let authoritativeErrorCode: string | undefined;
			if (this.deps.runAuthoritativeProjection) {
				try {
					const auth = await this.deps.runAuthoritativeProjection({
						snapshot,
						generation,
						jobId,
					});
					if (auth && auth.ok === false) {
						authoritativeFailed = true;
						authoritativeErrorCode = auth.errorCode ?? "authoritative_failed";
					}
				} catch {
					authoritativeFailed = true;
					authoritativeErrorCode = "authoritative_failed";
				}
			}

			this.setState("starting_worker");
			stageHint = "worker_spawn_failed";
			this.setState("worker_running");
			stageHint = "worker_protocol_failed";
			const workerResult = await this.deps.runWorkerJob({
				jobId,
				generation,
				snapshot,
				triggerReason: trigger.reason,
				requestedAt: trigger.requestedAt,
			});
			stageHint = undefined;

			if (this.stopping || this.stopped) {
				throw new Error("coordinator_stopping");
			}

			if (workerResult.timedOut) {
				throw new Error("worker_timeout");
			}
			if (workerResult.exitCode !== 0) {
				throw new Error("worker_exit_nonzero");
			}

			this.setState("validating_output");
			stageHint = "candidate_validation_failed";
			const result = workerResult.result ?? (await this.deps.readWorkerResult(jobId));
			if (!result) {
				throw new Error("result_missing");
			}
			if (result.jobId !== jobId) {
				throw new Error("result_job_mismatch");
			}
			if (result.generation !== generation) {
				throw new Error("result_generation_mismatch");
			}
			if (result.status !== "ok") {
				throw new Error("result_status_not_ok");
			}

			stageHint = "preparation_failed";
			const prepared = await this.deps.readPreparedOutput(jobId, inputRevision);
			if (prepared.inputRevision !== inputRevision) {
				throw new Error("result_input_revision_mismatch");
			}
			stageHint = undefined;

			this.lastSuccessfulInputRevision = inputRevision;
			this.lastSuccessfulPreparationRevision = prepared.preparationRevision;
			this.lastRunFailed = false;
			this.status.lastInputRevision = inputRevision;
			this.status.lastPreparationRevision = prepared.preparationRevision;
			this.status.lastResult = "success";
			this.status.lastErrorCode = undefined;
			this.status.lastErrorStage = undefined;
			this.status.lastErrorDetail = undefined;
			this.status.lastSkipReason = undefined;
			this.applyComparisonResult(this.deps.compareShadowOutput?.({ snapshot, prepared, jobId }));
			if (this.status.comparisonReferenceRevision) {
				this.status.candidateRevision = this.status.comparisonWorkerRevision;
			}
			await this.emitDualRunOutcome({
				result: "success",
				trigger,
				generation,
				jobId,
				snapshot,
				comparison: this.status.comparisonStatus
					? {
							status: this.status.comparisonStatus,
							referenceRevision: this.status.comparisonReferenceRevision,
							workerRevision: this.status.comparisonWorkerRevision,
							mismatchCount: this.status.comparisonMismatchCount ?? 0,
							mismatchedSlotCount: this.status.comparisonMismatchedSlots ?? 0,
							firstMismatchPath: this.status.comparisonFirstMismatch,
							firstMismatchDomain: this.status.comparisonFirstDomain,
						}
					: undefined,
				shuttingDown: this.stopping || this.stopped,
				authoritativeFailed,
				authoritativeErrorCode,
			});
			this.finishRun(startedAt, "succeeded");

			await this.deps.cleanupJob(jobId).catch(() => undefined);

			return {
				result: "success",
				jobId,
				generation,
				inputRevision,
				preparationRevision: prepared.preparationRevision,
				durationMs: this.status.lastDurationMs,
			};
		} catch (e) {
			const classified = classifyCoordinatorError(e, stageHint);
			const errorCode = this.normalizeErrorCode(e, classified.code);
			this.lastRunFailed = true;
			this.status.lastResult = "failed";
			this.status.lastErrorCode = errorCode;
			this.status.lastErrorStage = classified.stage;
			this.status.lastErrorDetail = classified.detail;
			this.status.lastSkipReason = undefined;
			// Preserve snapshot revision for diagnosis even when the run failed later.
			if (inputRevision) {
				this.status.lastInputRevision = inputRevision;
			}
			this.status.comparisonStatus = "worker_failed";
			this.status.comparisonMismatchCount = 0;
			this.status.comparisonFirstMismatch = undefined;
			this.logCoordinatorFailure(e, classified.stage, errorCode, classified.detail);
			if (snapshotForOutcome) {
				await this.emitDualRunOutcome({
					result: "failed",
					trigger,
					generation,
					jobId,
					snapshot: snapshotForOutcome,
					errorCode,
					shuttingDown: this.stopping || this.stopped || errorCode === "coordinator_stopping",
					authoritativeFailed: errorCode.includes("authoritative"),
					authoritativeErrorCode: errorCode.includes("authoritative") ? errorCode : undefined,
				});
			}
			this.finishRun(startedAt, "failed");
			if (jobId) {
				await this.deps.cleanupJob(jobId).catch(() => undefined);
			}
			return {
				result: "failed",
				errorCode,
				jobId,
				generation: generation || undefined,
				inputRevision,
				durationMs: this.status.lastDurationMs,
			};
		} finally {
			this.activeJobId = undefined;
			this.status.activeJobId = undefined;
			this.status.activeReason = undefined;
			this.runInProgress = false;
			try {
				void import("../planner_takeover/authoritative_projection.js")
					.then((m) => m.clearActiveAuthoritativeProjection())
					.catch(() => undefined);
			} catch {
				// optional
			}
			if (!this.stopping && !this.stopped && this.status.enabled) {
				if (this.status.state === "succeeded" || this.status.state === "failed") {
					this.setState("idle");
				}
			}
		}
	}

	private logCoordinatorFailure(
		error: unknown,
		stage: string,
		code: string,
		detail: string,
	): void {
		const name = error instanceof Error ? error.name : typeof error;
		this.log?.error?.(
			`planner coordinator failed stage=${stage} code=${code} name=${name} detail=${detail}`,
		);
		if (error instanceof Error && error.stack) {
			this.log?.debug?.(`planner coordinator stack: ${error.stack}`);
		}
	}

	private async emitDualRunOutcome(event: {
		result: "success" | "failed";
		trigger: PlannerTriggerRequest;
		generation: number;
		jobId?: string;
		snapshot: import("../planner_snapshot/types").PlannerInputSnapshot;
		comparison?:
			| PlannerShadowComparisonResult
			| import("../planner_shadow/candidate_compare").PlannerCandidateComparisonResult;
		errorCode?: string;
		shuttingDown: boolean;
		authoritativeFailed?: boolean;
		authoritativeErrorCode?: string;
	}): Promise<void> {
		if (!this.deps.onDualRunOutcome) return;
		try {
			await this.deps.onDualRunOutcome(event);
		} catch {
			// Dual-run / evidence failures must never fail the coordinator.
		}
	}

	private shouldSkipUnchangedInput(trigger: PlannerTriggerRequest, inputRevision: string): boolean {
		if (trigger.force === true) {
			return false;
		}
		if (this.lastRunFailed) {
			return false;
		}
		if (!this.lastSuccessfulInputRevision || !this.lastSuccessfulPreparationRevision) {
			return false;
		}
		return inputRevision === this.lastSuccessfulInputRevision;
	}

	private finishRun(startedAt: Date, finalState: "succeeded" | "failed"): void {
		const finishedAt = this.deps.now();
		this.status.lastFinishedAt = finishedAt.toISOString();
		this.status.lastDurationMs = finishedAt.getTime() - startedAt.getTime();
		this.setState(finalState);
	}

	private applyComparisonResult(
		comparison:
			| PlannerShadowComparisonResult
			| import("../planner_shadow/candidate_compare").PlannerCandidateComparisonResult
			| undefined,
	): void {
		if (!comparison) {
			return;
		}
		this.status.comparisonStatus = comparison.status;
		this.status.comparisonReferenceRevision = comparison.referenceRevision;
		this.status.comparisonWorkerRevision = comparison.workerRevision;
		this.status.comparisonMismatchCount = comparison.mismatchCount;
		this.status.comparisonFirstMismatch = comparison.firstMismatchPath;
		if ("firstMismatchDomain" in comparison) {
			this.status.comparisonFirstDomain = comparison.firstMismatchDomain;
		}
		if ("mismatchedSlotCount" in comparison) {
			this.status.comparisonMismatchedSlots = comparison.mismatchedSlotCount;
		}
		if (comparison.workerRevision) {
			this.status.candidateRevision = comparison.workerRevision;
		}
	}

	private notifyListeners(): void {
		if (this.listeners.size === 0) {
			return;
		}
		const snapshot = copyCoordinatorStatus(this.status);
		for (const listener of this.listeners) {
			try {
				listener(snapshot);
			} catch {
				// ignore listener failures
			}
		}
	}

	private normalizeErrorCode(error: unknown, classifiedCode?: string): string {
		if (error instanceof PlannerCoordinatorStageError) {
			return error.code || error.stage;
		}
		if (error instanceof PlannerInputValidationError) {
			return error.code;
		}
		if (classifiedCode && classifiedCode !== "coordinator_failed") {
			return classifiedCode;
		}
		const message = error instanceof Error ? error.message : String(error);
		const known = [
			"planner_disabled",
			"coordinator_stopping",
			"worker_timeout",
			"worker_exit_nonzero",
			"result_missing",
			"result_generation_mismatch",
			"result_input_revision_mismatch",
			"prepared_output_missing",
			"prepared_output_invalid",
			"prepared_output_budget_exceeded",
			"snapshot_build_failed",
			"runtime_import_failed",
			"snapshot_source_failed",
			"worker_spawn_failed",
			"worker_protocol_failed",
			"candidate_validation_failed",
			"preparation_failed",
		];
		for (const code of known) {
			if (message.includes(code)) {
				return code;
			}
		}
		if (message.includes("input_revision_mismatch")) {
			return "result_input_revision_mismatch";
		}
		if (message.includes("generation")) {
			return "result_generation_mismatch";
		}
		if (message.includes("job path must not be under durable")) {
			return "worker_spawn_failed";
		}
		return classifiedCode ?? "coordinator_failed";
	}

	private setState(state: PlannerCoordinatorState): void {
		if (this.status.state === state) {
			return;
		}
		this.status.state = state;
		this.notifyListeners();
	}
}

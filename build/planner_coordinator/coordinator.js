"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerOnDemandCoordinator = void 0;
const types_1 = require("../planner_preparation/types");
const status_1 = require("./status");
const trigger_1 = require("./trigger");
class PlannerOnDemandCoordinator {
    deps;
    status;
    runInProgress = false;
    runSlotTaken = false;
    stopping = false;
    stopped = false;
    lastSuccessfulInputRevision;
    lastSuccessfulPreparationRevision;
    lastRunFailed = false;
    activeJobId;
    pendingTrigger;
    queuePromise = Promise.resolve();
    listeners = new Set();
    constructor(deps, options = {}) {
        this.deps = deps;
        const enabled = options.enabled ?? false;
        this.status = (0, status_1.createInitialCoordinatorStatus)(enabled);
    }
    enable() {
        if (this.stopped) {
            return;
        }
        this.status.enabled = true;
        if (this.status.state === "disabled") {
            this.setState("idle");
        }
        else {
            this.notifyListeners();
        }
    }
    async disable(options = {}) {
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
    subscribeStatus(listener) {
        this.listeners.add(listener);
        listener((0, status_1.copyCoordinatorStatus)(this.status));
        return () => {
            this.listeners.delete(listener);
        };
    }
    getStatus() {
        return (0, status_1.copyCoordinatorStatus)(this.status);
    }
    hasActiveJobReference() {
        return this.activeJobId !== undefined;
    }
    /** Test hook: coordinator never retains full snapshot or prepared payloads. */
    getRetainedPayloadBytes() {
        return 0;
    }
    async request(trigger) {
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
            this.pendingTrigger = (0, trigger_1.mergeTriggerRequests)(this.pendingTrigger, trigger);
            this.status.pendingReason = this.pendingTrigger.reason;
            this.notifyListeners();
            return { result: "coalesced" };
        }
        const outcome = await this.enqueueRun(trigger);
        return outcome;
    }
    async stop() {
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
    enqueueRun(trigger) {
        this.runSlotTaken = true;
        let outcome;
        this.queuePromise = this.queuePromise
            .then(async () => {
            outcome = await this.runWithOptionalFollowUp(trigger);
        })
            .finally(() => {
            this.runSlotTaken = false;
        });
        return this.queuePromise.then(() => outcome);
    }
    async runWithOptionalFollowUp(trigger) {
        let lastOutcome = await this.runOnce(trigger);
        while (this.status.rerunPending && !this.stopping && !this.stopped && this.status.enabled) {
            this.status.rerunPending = false;
            const followUp = this.pendingTrigger ??
                ({
                    reason: trigger.reason,
                    requestedAt: this.deps.now().toISOString(),
                    force: trigger.force,
                });
            this.pendingTrigger = undefined;
            this.status.pendingReason = undefined;
            lastOutcome = await this.runOnce(followUp);
        }
        return lastOutcome;
    }
    async runOnce(trigger) {
        if (this.stopping || this.stopped || !this.status.enabled) {
            return { result: "failed", errorCode: "coordinator_stopping" };
        }
        this.runInProgress = true;
        this.status.activeReason = trigger.reason;
        const startedAt = this.deps.now();
        this.status.lastStartedAt = startedAt.toISOString();
        let jobId;
        let generation = 0;
        let inputRevision;
        try {
            this.setState("building_snapshot");
            const snapshot = await this.deps.buildSnapshot();
            inputRevision = snapshot.inputRevision;
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
            this.setState("starting_worker");
            this.setState("worker_running");
            const workerResult = await this.deps.runWorkerJob({
                jobId,
                generation,
                snapshot,
                triggerReason: trigger.reason,
                requestedAt: trigger.requestedAt,
            });
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
            const prepared = await this.deps.readPreparedOutput(jobId, inputRevision);
            if (prepared.inputRevision !== inputRevision) {
                throw new Error("result_input_revision_mismatch");
            }
            this.lastSuccessfulInputRevision = inputRevision;
            this.lastSuccessfulPreparationRevision = prepared.preparationRevision;
            this.lastRunFailed = false;
            this.status.lastInputRevision = inputRevision;
            this.status.lastPreparationRevision = prepared.preparationRevision;
            this.status.lastResult = "success";
            this.status.lastErrorCode = undefined;
            this.status.lastSkipReason = undefined;
            this.applyComparisonResult(this.deps.compareShadowOutput?.({ snapshot, prepared, jobId }));
            if (this.status.comparisonReferenceRevision) {
                this.status.candidateRevision = this.status.comparisonWorkerRevision;
            }
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
        }
        catch (e) {
            const errorCode = this.normalizeErrorCode(e);
            this.lastRunFailed = true;
            this.status.lastResult = "failed";
            this.status.lastErrorCode = errorCode;
            this.status.lastSkipReason = undefined;
            this.status.comparisonStatus = "worker_failed";
            this.status.comparisonMismatchCount = 0;
            this.status.comparisonFirstMismatch = undefined;
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
        }
        finally {
            this.activeJobId = undefined;
            this.status.activeJobId = undefined;
            this.status.activeReason = undefined;
            this.runInProgress = false;
            if (!this.stopping && !this.stopped && this.status.enabled) {
                if (this.status.state === "succeeded" || this.status.state === "failed") {
                    this.setState("idle");
                }
            }
        }
    }
    shouldSkipUnchangedInput(trigger, inputRevision) {
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
    finishRun(startedAt, finalState) {
        const finishedAt = this.deps.now();
        this.status.lastFinishedAt = finishedAt.toISOString();
        this.status.lastDurationMs = finishedAt.getTime() - startedAt.getTime();
        this.setState(finalState);
    }
    applyComparisonResult(comparison) {
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
    notifyListeners() {
        if (this.listeners.size === 0) {
            return;
        }
        const snapshot = (0, status_1.copyCoordinatorStatus)(this.status);
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            }
            catch {
                // ignore listener failures
            }
        }
    }
    normalizeErrorCode(error) {
        if (error instanceof types_1.PlannerInputValidationError) {
            return error.code;
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
        return "coordinator_failed";
    }
    setState(state) {
        if (this.status.state === state) {
            return;
        }
        this.status.state = state;
        this.notifyListeners();
    }
}
exports.PlannerOnDemandCoordinator = PlannerOnDemandCoordinator;

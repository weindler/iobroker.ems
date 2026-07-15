import * as path from "node:path";
import { resolveEmsPaths } from "../backup_integration/paths";
import { PlannerJobLifecycle } from "../planner_job/lifecycle";
import { PLANNER_DEFAULT_JOB_TIMEOUT_MS } from "../planner_job/constants";
import type { PlannerJobRequest } from "../planner_contracts/types";
import { readAndValidatePreparedInputFile } from "../planner_preparation/validate";
import { resolvePlannerPaths } from "../planner_paths/paths";
import { readJobResult, PlannerRepository } from "../planner_repository/repository";
import { buildPlannerInputSnapshotFromIoBroker } from "../planner_snapshot/from_iobroker";
import type { PlannerSnapshotIoBrokerHost } from "../planner_snapshot/iobroker_source";
import { writePlannerInputSnapshot } from "../planner_snapshot/write";
import { triggerToJobTrigger } from "./trigger";
import type {
	PlannerOnDemandCoordinatorDependencies,
	PlannerWorkerRunResult,
} from "./types";

export interface PlannerCoordinatorAdapterHost extends PlannerSnapshotIoBrokerHost {
	namespace: string;
	getAbsoluteInstanceDataDir(): string;
}

export interface PlannerRuntimeContextOptions {
	packageRoot?: string;
}

export interface PlannerRuntimeContext {
	deps: PlannerOnDemandCoordinatorDependencies;
	lifecycle: PlannerJobLifecycle;
}

export function createPlannerRuntimeContext(
	adapter: PlannerCoordinatorAdapterHost,
	options: PlannerRuntimeContextOptions = {},
): PlannerRuntimeContext {
	const layout = resolvePlannerPaths({
		namespace: adapter.namespace,
		getAbsoluteInstanceDataDir: () => adapter.getAbsoluteInstanceDataDir(),
	});
	const emsPaths = resolveEmsPaths({
		namespace: adapter.namespace,
		getAbsoluteInstanceDataDir: () => adapter.getAbsoluteInstanceDataDir(),
	});
	const repository = new PlannerRepository(layout);
	const lifecycle = new PlannerJobLifecycle(layout, repository);
	const packageRoot = options.packageRoot ?? path.resolve(__dirname, "..", "..");
	const workerScriptPath = lifecycle.resolveWorkerPath(packageRoot);

	const deps: PlannerOnDemandCoordinatorDependencies = {
		now: () => new Date(),
		buildSnapshot: () => buildPlannerInputSnapshotFromIoBroker(adapter),
		isWorkerRunning: () => lifecycle.isRunning(),
		shutdownWorker: () => lifecycle.shutdown(),
		readWorkerResult: async (jobId) => readJobResult(layout.jobDir(jobId)),
		readPreparedOutput: (jobId, expectedInputRevision) =>
			readAndValidatePreparedInputFile(layout.jobDir(jobId), {
				expectedInputRevision,
				runtimeRootDir: layout.runtimePlannerDir,
			}),
		cleanupJob: async (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), true),
		runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt, timeoutMs }) => {
			const jobDir = layout.jobDir(jobId);
			await writePlannerInputSnapshot(jobDir, snapshot, {
				runtimeRootDir: layout.runtimePlannerDir,
				durableDataDir: emsPaths.durableDataDir,
			});
			const request: PlannerJobRequest = {
				schemaVersion: 1,
				kind: "planner_snapshot_v2",
				jobId,
				generation,
				trigger: triggerToJobTrigger(triggerReason),
				mode: "simulation",
				requestedAt,
				timeoutMs: timeoutMs ?? PLANNER_DEFAULT_JOB_TIMEOUT_MS,
				inputSnapshotPath: path.join(jobDir, "input.json"),
			};
			const runResult = await lifecycle.runJob({
				request,
				input: snapshot as unknown as import("../planner_contracts/types").PlannerInputSnapshot,
				workerScriptPath,
				timeoutMs,
			});
			const result = await readJobResult(jobDir);
			const merged: PlannerWorkerRunResult = { ...runResult, result };
			return merged;
		},
	};

	return { deps, lifecycle };
}

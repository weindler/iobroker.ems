import * as fs from "node:fs";
import * as path from "node:path";
import { resolveEmsPaths } from "../backup_integration/paths";
import { PlannerJobLifecycle } from "../planner_job/lifecycle";
import { PLANNER_DEFAULT_JOB_TIMEOUT_MS } from "../planner_job/constants";
import type { PlannerJobRequest } from "../planner_contracts/types";
import { readAndValidatePreparedInputFile } from "../planner_preparation/validate";
import { resolvePlannerPaths } from "../planner_paths/paths";
import { PLANNER_CANDIDATE_FILE } from "../planner_candidate/types";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import { buildPlanCandidateFromSnapshot } from "../planner_candidate/build";
import { comparePlanCandidates } from "../planner_shadow/candidate_compare";
import { compareSnapshotPreparedInput } from "../planner_shadow/compare";
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
		cleanupJob: async (jobId) => {
			// Preserve last candidate under non-canonical candidate area before job cleanup.
			try {
				const src = path.join(layout.jobDir(jobId), PLANNER_CANDIDATE_FILE);
				const destDir = layout.candidateJobDir(jobId);
				await fs.promises.mkdir(destDir, { recursive: true, mode: 0o700 });
				await fs.promises.copyFile(src, path.join(destDir, PLANNER_CANDIDATE_FILE));
			} catch {
				// absent candidate is fine
			}
			await repository.cleanupJobDir(layout.jobDir(jobId), true);
		},
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
		compareShadowOutput: ({ snapshot, prepared, jobId }) => {
			if (!jobId) {
				return compareSnapshotPreparedInput(snapshot, prepared).result;
			}
			try {
				const reference = buildPlanCandidateFromSnapshot(snapshot).candidate;
				const raw = fs.readFileSync(path.join(layout.jobDir(jobId), PLANNER_CANDIDATE_FILE), "utf8");
				const worker = JSON.parse(raw) as PlannerPlanCandidate;
				return comparePlanCandidates(reference, worker);
			} catch {
				return {
					status: "worker_failed" as const,
					mismatchCount: 0,
					mismatchedSlotCount: 0,
					firstMismatchPath: "candidate_read",
				};
			}
		},
	};

	return { deps, lifecycle };
}

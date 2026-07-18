import * as fs from "node:fs";
import * as path from "node:path";
import {
	categoryDataPath,
	resolveEmsPaths,
	type PathResolverInput,
} from "../backup_integration/paths";
import { PlannerJobLifecycle } from "../planner_job/lifecycle";
import { PLANNER_DEFAULT_JOB_TIMEOUT_MS } from "../planner_job/constants";
import type { PlannerJobRequest } from "../planner_contracts/types";
import { readAndValidatePreparedInputFile } from "../planner_preparation/validate";
import { resolvePlannerPaths } from "../planner_paths/paths";
import { PLANNER_CANDIDATE_FILE } from "../planner_candidate/types";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import { comparePlanCandidates } from "../planner_shadow/candidate_compare";
import { compareSnapshotPreparedInput } from "../planner_shadow/compare";
import { readJobResult, PlannerRepository } from "../planner_repository/repository";
import { buildPlannerInputSnapshotFromIoBroker } from "../planner_snapshot/from_iobroker";
import type { PlannerSnapshotIoBrokerHost } from "../planner_snapshot/iobroker_source";
import { writePlannerInputSnapshot } from "../planner_snapshot/write";
import {
	authoritativeProjectionIsUsable,
	computeAuthoritativeDualRunProjection,
	forbidAuthoritativeRecompute,
	getActiveAuthoritativeProjection,
} from "../planner_takeover/authoritative_projection";
import { triggerToJobTrigger } from "./trigger";
import type {
	PlannerOnDemandCoordinatorDependencies,
	PlannerWorkerRunResult,
} from "./types";

/**
 * Minimal ioBroker adapter surface for the on-demand coordinator.
 * Do not require adapter.getAbsoluteInstanceDataDir — that method is not part of
 * the real adapter contract; durable/runtime dirs come from resolveEmsPaths /
 * @iobroker/adapter-core.getAbsoluteInstanceDataDir(adapter).
 */
export interface PlannerCoordinatorAdapterHost extends PlannerSnapshotIoBrokerHost {
	namespace: string;
	/** Test/injection only — production uses adapter-core via resolveEmsPaths(adapter). */
	durableDataDir?: string;
}

export interface PlannerRuntimeContextOptions {
	packageRoot?: string;
	/**
	 * Optional serializable path contract for tests / explicit injection.
	 * Defaults to the adapter (central EMS path resolver + adapter-core).
	 */
	paths?: PathResolverInput;
}

export interface PlannerRuntimeContext {
	deps: PlannerOnDemandCoordinatorDependencies;
	lifecycle: PlannerJobLifecycle;
	/** Resolved layout — exposed for diagnostics/tests only. */
	pathInput: PathResolverInput;
	durableDataDir: string;
	runtimeDataDir: string;
	runtimeJobsDir: string;
}

function snapshotHostWithPaths(
	adapter: PlannerCoordinatorAdapterHost,
	emsPaths: ReturnType<typeof resolveEmsPaths>,
): PlannerSnapshotIoBrokerHost {
	if (typeof adapter.getAbsolutePath === "function") {
		return adapter;
	}
	const out = Object.create(adapter) as PlannerSnapshotIoBrokerHost;
	out.getAbsolutePath = (category?: string) => categoryDataPath(emsPaths, category);
	return out;
}

export function createPlannerRuntimeContext(
	adapter: PlannerCoordinatorAdapterHost,
	options: PlannerRuntimeContextOptions = {},
): PlannerRuntimeContext {
	const pathInput: PathResolverInput = options.paths ?? adapter;
	const layout = resolvePlannerPaths(pathInput);
	const emsPaths = resolveEmsPaths(pathInput);
	const snapshotHost = snapshotHostWithPaths(adapter, emsPaths);
	const repository = new PlannerRepository(layout);
	const lifecycle = new PlannerJobLifecycle(layout, repository);
	const packageRoot = options.packageRoot ?? path.resolve(__dirname, "..", "..");
	const workerScriptPath = lifecycle.resolveWorkerPath(packageRoot);

	const deps: PlannerOnDemandCoordinatorDependencies = {
		now: () => new Date(),
		buildSnapshot: () => buildPlannerInputSnapshotFromIoBroker(snapshotHost),
		isWorkerRunning: () => lifecycle.isRunning(),
		shutdownWorker: () => lifecycle.shutdown(),
		readWorkerResult: async (jobId) => readJobResult(layout.jobDir(jobId)),
		readPreparedOutput: (jobId, expectedInputRevision) =>
			readAndValidatePreparedInputFile(layout.jobDir(jobId), {
				expectedInputRevision,
				runtimeRootDir: layout.runtimePlannerDir,
			}),
		cleanupJob: async (jobId) => {
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
		runAuthoritativeProjection: async ({ snapshot, generation, jobId }) => {
			try {
				const { getAuthoritySession } = await import("../planner_authority/runtime_session.js");
				const auth = getAuthoritySession().service;
				if (auth?.shouldSkipLegacyAuthoritativeProjection()) {
					return { ok: true };
				}
			} catch {
				// authority optional
			}
			const projection = computeAuthoritativeDualRunProjection({
				snapshot,
				generation,
				jobId,
				// Dual-run seal only — never durable canonical publish.
				sealPublish: () => true,
			});
			if (projection.publishStatus !== "ok") {
				return {
					ok: false,
					errorCode: projection.publishErrorCode ?? "authoritative_publish_failed",
				};
			}
			return { ok: true };
		},
		runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt, timeoutMs }) => {
			const { captureRssSnapshot } = await import("../planner_authority/memory.js");
			const before = captureRssSnapshot();
			let legacyModuleLoaded = false;
			try {
				const { getAuthoritySession } = await import("../planner_authority/runtime_session.js");
				const auth = getAuthoritySession().service;
				legacyModuleLoaded = !(auth?.shouldSkipLegacyAuthoritativeProjection() ?? false);
			} catch {
				legacyModuleLoaded = true;
			}

			const jobDir = layout.jobDir(jobId);
			try {
				await writePlannerInputSnapshot(jobDir, snapshot, {
					runtimeRootDir: layout.runtimePlannerDir,
					durableDataDir: emsPaths.durableDataDir,
				});
			} catch (error) {
				const { wrapCoordinatorStageError } = await import("./errors.js");
				throw wrapCoordinatorStageError("worker_spawn_failed", "worker_spawn_failed", error);
			}
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
			let runResult;
			try {
				runResult = await lifecycle.runJob({
					request,
					input: snapshot as unknown as import("../planner_contracts/types").PlannerInputSnapshot,
					workerScriptPath,
					timeoutMs,
				});
			} catch (error) {
				const { wrapCoordinatorStageError } = await import("./errors.js");
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("already running") || message.includes("ENOENT") || message.includes("spawn")) {
					throw wrapCoordinatorStageError("worker_spawn_failed", "worker_spawn_failed", error);
				}
				throw wrapCoordinatorStageError("worker_protocol_failed", "worker_protocol_failed", error);
			}
			const result = await readJobResult(jobDir);
			const after = captureRssSnapshot();
			const delta = Math.round((after.rssMiB - before.rssMiB) * 10) / 10;
			try {
				const { recordPlannerAuthorityWorkerMemory } = await import("../planner_authority/runtime.js");
				await recordPlannerAuthorityWorkerMemory({
					rssBeforeWorkerJobMib: before.rssMiB,
					rssAfterWorkerExitMib: after.rssMiB,
					lastWorkerDeltaMib: delta,
					legacyModuleLoaded,
				});
			} catch {
				// memory diagnostics optional
			}
			const merged: PlannerWorkerRunResult = { ...runResult, result };
			return merged;
		},
		compareShadowOutput: ({ snapshot, prepared, jobId }) => {
			if (!jobId) {
				return compareSnapshotPreparedInput(snapshot, prepared).result;
			}
			try {
				const stored = getActiveAuthoritativeProjection();
				if (!authoritativeProjectionIsUsable(stored) || stored.jobId !== jobId) {
					forbidAuthoritativeRecompute();
					return {
						status: "in_process_failed" as const,
						mismatchCount: 0,
						mismatchedSlotCount: 0,
						firstMismatchPath: "authoritative_projection_missing",
						firstMismatchDomain: "authoritative",
					};
				}
				const reference = stored.candidate;
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
		onDualRunOutcome: async (event) => {
			const { getDualRunBridgeContext } = await import("../planner_takeover/session.js");
			const ctx = getDualRunBridgeContext();
			if (!ctx) return;
			const { handleCoordinatorDualRunOutcome } = await import("../planner_takeover/dual_run_bridge.js");
			await handleCoordinatorDualRunOutcome(ctx, event);
		},
	};

	return {
		deps,
		lifecycle,
		pathInput,
		durableDataDir: emsPaths.durableDataDir,
		runtimeDataDir: emsPaths.runtimeDataDir,
		runtimeJobsDir: layout.runtimeJobsDir,
	};
}

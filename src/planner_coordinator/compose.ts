import type { PathResolverInput } from "../backup_integration/paths";
import { PlannerOnDemandCoordinator } from "./coordinator";
import { wrapCoordinatorStageError } from "./errors";
import type {
	PlannerOnDemandCoordinatorDependencies,
	PlannerOnDemandCoordinatorOptions,
} from "./types";
import type { PlannerCoordinatorAdapterHost, PlannerRuntimeContext } from "./runtime_factory";

export type PlannerCoordinatorComposeOptions = PlannerOnDemandCoordinatorOptions & {
	packageRoot?: string;
	/** Optional path contract forwarded to resolvePlannerPaths / resolveEmsPaths. */
	paths?: PathResolverInput;
};

let activeCoordinator: PlannerOnDemandCoordinator | null = null;
let activeAdapterHost: PlannerCoordinatorAdapterHost | null = null;
let runtimeContext: PlannerRuntimeContext | null = null;
let runtimeLoadPromise: Promise<PlannerRuntimeContext> | null = null;

export class PlannerCoordinatorAlreadyActiveError extends Error {
	constructor() {
		super("planner_coordinator_already_active");
		this.name = "PlannerCoordinatorAlreadyActiveError";
	}
}

export function getPlannerOnDemandCoordinator(): PlannerOnDemandCoordinator | null {
	return activeCoordinator;
}

export async function setPlannerOnDemandCoordinatorEnabled(enabled: boolean): Promise<void> {
	const coordinator = activeCoordinator;
	if (!coordinator) {
		return;
	}
	if (enabled) {
		coordinator.enable();
		return;
	}
	await coordinator.disable({ interruptActive: true });
}

async function loadRuntimeContext(
	host: PlannerCoordinatorAdapterHost,
	options: PlannerCoordinatorComposeOptions,
): Promise<PlannerRuntimeContext> {
	if (runtimeContext) {
		return runtimeContext;
	}
	if (!runtimeLoadPromise) {
		runtimeLoadPromise = import("./runtime_factory.js")
			.then((module) =>
				module.createPlannerRuntimeContext(host, {
					packageRoot: options.packageRoot,
					paths: options.paths,
				}),
			)
			.catch((error) => {
				runtimeLoadPromise = null;
				throw wrapCoordinatorStageError("runtime_import_failed", "runtime_import_failed", error);
			});
	}
	try {
		runtimeContext = await runtimeLoadPromise;
		return runtimeContext;
	} catch (error) {
		runtimeLoadPromise = null;
		runtimeContext = null;
		throw wrapCoordinatorStageError("runtime_import_failed", "runtime_import_failed", error);
	}
}

function createLazyRuntimeDependencies(
	host: PlannerCoordinatorAdapterHost,
	options: PlannerCoordinatorComposeOptions,
): PlannerOnDemandCoordinatorDependencies {
	return {
		now: () => new Date(),
		buildSnapshot: async () => {
			const runtime = await loadRuntimeContext(host, options);
			try {
				return await runtime.deps.buildSnapshot();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (
					message.includes("getAbsolutePath") ||
					message.includes("readState failed") ||
					message.includes("readForeignState failed") ||
					message.includes("snapshot file")
				) {
					throw wrapCoordinatorStageError("snapshot_source_failed", "snapshot_source_failed", error);
				}
				throw wrapCoordinatorStageError("snapshot_build_failed", "snapshot_build_failed", error);
			}
		},
		isWorkerRunning: () => {
			if (!runtimeContext) {
				return false;
			}
			return runtimeContext.deps.isWorkerRunning();
		},
		shutdownWorker: async () => {
			// Never load runtime factory just to stop an unused coordinator.
			if (!runtimeContext) {
				return;
			}
			return runtimeContext.deps.shutdownWorker();
		},
		readWorkerResult: async (jobId) => {
			const runtime = await loadRuntimeContext(host, options);
			try {
				return await runtime.deps.readWorkerResult(jobId);
			} catch (error) {
				throw wrapCoordinatorStageError("worker_protocol_failed", "result_missing", error);
			}
		},
		readPreparedOutput: async (jobId, expectedInputRevision) => {
			const runtime = await loadRuntimeContext(host, options);
			try {
				return await runtime.deps.readPreparedOutput(jobId, expectedInputRevision);
			} catch (error) {
				throw wrapCoordinatorStageError("preparation_failed", "prepared_output_missing", error);
			}
		},
		cleanupJob: async (jobId) => {
			if (!runtimeContext) {
				return;
			}
			return runtimeContext.deps.cleanupJob(jobId);
		},
		runWorkerJob: async (args) => {
			const runtime = await loadRuntimeContext(host, options);
			try {
				return await runtime.deps.runWorkerJob(args);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (
					message.includes("job path must not be under durable") ||
					message.includes("ENOENT") ||
					message.includes("spawn")
				) {
					throw wrapCoordinatorStageError("worker_spawn_failed", "worker_spawn_failed", error);
				}
				throw wrapCoordinatorStageError("worker_protocol_failed", "worker_protocol_failed", error);
			}
		},
		runAuthoritativeProjection: async (args) => {
			const runtime = await loadRuntimeContext(host, options);
			if (!runtime.deps.runAuthoritativeProjection) {
				return { ok: true };
			}
			return runtime.deps.runAuthoritativeProjection(args);
		},
		compareShadowOutput: (input) => {
			if (!runtimeContext?.deps.compareShadowOutput) {
				throw wrapCoordinatorStageError(
					"candidate_validation_failed",
					"compare_shadow_output_unavailable",
					new Error("compare_shadow_output_unavailable"),
				);
			}
			try {
				return runtimeContext.deps.compareShadowOutput(input);
			} catch (error) {
				throw wrapCoordinatorStageError(
					"candidate_validation_failed",
					"candidate_validation_failed",
					error,
				);
			}
		},
		onDualRunOutcome: async (event) => {
			const runtime = await loadRuntimeContext(host, options);
			if (!runtime.deps.onDualRunOutcome) return;
			await runtime.deps.onDualRunOutcome(event);
		},
	};
}

export function createPlannerOnDemandCoordinatorFromAdapter(
	adapter: PlannerCoordinatorAdapterHost,
	options: PlannerCoordinatorComposeOptions = {},
): PlannerOnDemandCoordinator {
	if (activeCoordinator) {
		const state = activeCoordinator.getStatus().state;
		if (state !== "stopped") {
			throw new PlannerCoordinatorAlreadyActiveError();
		}
	}
	// Snapshot getAbsolutePath is attached lazily inside createPlannerRuntimeContext via resolveEmsPaths.
	const coordinator = new PlannerOnDemandCoordinator(
		createLazyRuntimeDependencies(adapter, options),
		options,
	);
	activeCoordinator = coordinator;
	activeAdapterHost = adapter;
	return coordinator;
}

export async function stopPlannerOnDemandCoordinator(): Promise<void> {
	const coordinator = activeCoordinator;
	activeCoordinator = null;
	activeAdapterHost = null;
	if (coordinator) {
		await coordinator.stop();
	}
	runtimeContext = null;
	runtimeLoadPromise = null;
}

export function createPlannerOnDemandCoordinatorForTest(
	deps: PlannerOnDemandCoordinatorDependencies,
	options?: PlannerOnDemandCoordinatorOptions,
): PlannerOnDemandCoordinator {
	return new PlannerOnDemandCoordinator(deps, options);
}

/** Test hook: register an active coordinator without loading runtime modules. */
export function registerPlannerOnDemandCoordinatorForTest(
	coordinator: PlannerOnDemandCoordinator,
): void {
	if (activeCoordinator) {
		const state = activeCoordinator.getStatus().state;
		if (state !== "stopped") {
			throw new PlannerCoordinatorAlreadyActiveError();
		}
	}
	activeCoordinator = coordinator;
}

/** Test hook: inspect whether runtime modules were loaded via lazy factory. */
export function isPlannerRuntimeContextLoadedForTest(): boolean {
	return runtimeContext !== null || runtimeLoadPromise !== null;
}

/** Test hook: clear lazy runtime load state without stopping a registered test coordinator. */
export function resetPlannerRuntimeLoadStateForTest(): void {
	runtimeContext = null;
	runtimeLoadPromise = null;
}

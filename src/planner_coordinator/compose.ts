import { PlannerOnDemandCoordinator } from "./coordinator";
import type {
	PlannerOnDemandCoordinatorDependencies,
	PlannerOnDemandCoordinatorOptions,
} from "./types";
import type { PlannerCoordinatorAdapterHost, PlannerRuntimeContext } from "./runtime_factory";

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
	options: PlannerOnDemandCoordinatorOptions & { packageRoot?: string },
): Promise<PlannerRuntimeContext> {
	if (runtimeContext) {
		return runtimeContext;
	}
	if (!runtimeLoadPromise) {
		runtimeLoadPromise = import("./runtime_factory.js").then((module) =>
			module.createPlannerRuntimeContext(host, { packageRoot: options.packageRoot }),
		);
	}
	runtimeContext = await runtimeLoadPromise;
	return runtimeContext;
}

function createLazyRuntimeDependencies(
	host: PlannerCoordinatorAdapterHost,
	options: PlannerOnDemandCoordinatorOptions & { packageRoot?: string },
): PlannerOnDemandCoordinatorDependencies {
	return {
		now: () => new Date(),
		buildSnapshot: async () => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.buildSnapshot();
		},
		isWorkerRunning: () => {
			if (!runtimeContext) {
				return false;
			}
			return runtimeContext.deps.isWorkerRunning();
		},
		shutdownWorker: async () => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.shutdownWorker();
		},
		readWorkerResult: async (jobId) => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.readWorkerResult(jobId);
		},
		readPreparedOutput: async (jobId, expectedInputRevision) => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.readPreparedOutput(jobId, expectedInputRevision);
		},
		cleanupJob: async (jobId) => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.cleanupJob(jobId);
		},
		runWorkerJob: async (args) => {
			const runtime = await loadRuntimeContext(host, options);
			return runtime.deps.runWorkerJob(args);
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
				throw new Error("compare_shadow_output_unavailable");
			}
			return runtimeContext.deps.compareShadowOutput(input);
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
	options: PlannerOnDemandCoordinatorOptions & { packageRoot?: string } = {},
): PlannerOnDemandCoordinator {
	if (activeCoordinator) {
		const state = activeCoordinator.getStatus().state;
		if (state !== "stopped") {
			throw new PlannerCoordinatorAlreadyActiveError();
		}
	}
	const coordinator = new PlannerOnDemandCoordinator(createLazyRuntimeDependencies(adapter, options), options);
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

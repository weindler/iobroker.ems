"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPlannerRuntimeLoadStateForTest = exports.isPlannerRuntimeContextLoadedForTest = exports.registerPlannerOnDemandCoordinatorForTest = exports.createPlannerOnDemandCoordinatorForTest = exports.stopPlannerOnDemandCoordinator = exports.createPlannerOnDemandCoordinatorFromAdapter = exports.setPlannerOnDemandCoordinatorEnabled = exports.getPlannerOnDemandCoordinator = exports.PlannerCoordinatorAlreadyActiveError = void 0;
const data_dir_1 = require("../learning/data_dir");
const coordinator_1 = require("./coordinator");
const errors_1 = require("./errors");
let activeCoordinator = null;
let activeAdapterHost = null;
let runtimeContext = null;
let runtimeLoadPromise = null;
class PlannerCoordinatorAlreadyActiveError extends Error {
    constructor() {
        super("planner_coordinator_already_active");
        this.name = "PlannerCoordinatorAlreadyActiveError";
    }
}
exports.PlannerCoordinatorAlreadyActiveError = PlannerCoordinatorAlreadyActiveError;
function getPlannerOnDemandCoordinator() {
    return activeCoordinator;
}
exports.getPlannerOnDemandCoordinator = getPlannerOnDemandCoordinator;
async function setPlannerOnDemandCoordinatorEnabled(enabled) {
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
exports.setPlannerOnDemandCoordinatorEnabled = setPlannerOnDemandCoordinatorEnabled;
async function loadRuntimeContext(host, options) {
    if (runtimeContext) {
        return runtimeContext;
    }
    if (!runtimeLoadPromise) {
        runtimeLoadPromise = Promise.resolve().then(() => __importStar(require("./runtime_factory.js"))).then((module) => module.createPlannerRuntimeContext(host, { packageRoot: options.packageRoot }))
            .catch((error) => {
            runtimeLoadPromise = null;
            throw (0, errors_1.wrapCoordinatorStageError)("runtime_import_failed", "runtime_import_failed", error);
        });
    }
    try {
        runtimeContext = await runtimeLoadPromise;
        return runtimeContext;
    }
    catch (error) {
        runtimeLoadPromise = null;
        runtimeContext = null;
        throw (0, errors_1.wrapCoordinatorStageError)("runtime_import_failed", "runtime_import_failed", error);
    }
}
function createLazyRuntimeDependencies(host, options) {
    return {
        now: () => new Date(),
        buildSnapshot: async () => {
            const runtime = await loadRuntimeContext(host, options);
            try {
                return await runtime.deps.buildSnapshot();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("getAbsolutePath") ||
                    message.includes("readState failed") ||
                    message.includes("readForeignState failed") ||
                    message.includes("snapshot file")) {
                    throw (0, errors_1.wrapCoordinatorStageError)("snapshot_source_failed", "snapshot_source_failed", error);
                }
                throw (0, errors_1.wrapCoordinatorStageError)("snapshot_build_failed", "snapshot_build_failed", error);
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
            }
            catch (error) {
                throw (0, errors_1.wrapCoordinatorStageError)("worker_protocol_failed", "result_missing", error);
            }
        },
        readPreparedOutput: async (jobId, expectedInputRevision) => {
            const runtime = await loadRuntimeContext(host, options);
            try {
                return await runtime.deps.readPreparedOutput(jobId, expectedInputRevision);
            }
            catch (error) {
                throw (0, errors_1.wrapCoordinatorStageError)("preparation_failed", "prepared_output_missing", error);
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
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes("job path must not be under durable") ||
                    message.includes("ENOENT") ||
                    message.includes("spawn")) {
                    throw (0, errors_1.wrapCoordinatorStageError)("worker_spawn_failed", "worker_spawn_failed", error);
                }
                throw (0, errors_1.wrapCoordinatorStageError)("worker_protocol_failed", "worker_protocol_failed", error);
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
                throw (0, errors_1.wrapCoordinatorStageError)("candidate_validation_failed", "compare_shadow_output_unavailable", new Error("compare_shadow_output_unavailable"));
            }
            try {
                return runtimeContext.deps.compareShadowOutput(input);
            }
            catch (error) {
                throw (0, errors_1.wrapCoordinatorStageError)("candidate_validation_failed", "candidate_validation_failed", error);
            }
        },
        onDualRunOutcome: async (event) => {
            const runtime = await loadRuntimeContext(host, options);
            if (!runtime.deps.onDualRunOutcome)
                return;
            await runtime.deps.onDualRunOutcome(event);
        },
    };
}
function asCoordinatorHost(adapter) {
    // Ensure learning/data path helpers exist for snapshot JSON reads on first lazy load.
    if (typeof adapter.getAbsolutePath === "function") {
        return adapter;
    }
    return (0, data_dir_1.withLearningDataPath)(adapter, adapter);
}
function createPlannerOnDemandCoordinatorFromAdapter(adapter, options = {}) {
    if (activeCoordinator) {
        const state = activeCoordinator.getStatus().state;
        if (state !== "stopped") {
            throw new PlannerCoordinatorAlreadyActiveError();
        }
    }
    const host = asCoordinatorHost(adapter);
    const coordinator = new coordinator_1.PlannerOnDemandCoordinator(createLazyRuntimeDependencies(host, options), options);
    activeCoordinator = coordinator;
    activeAdapterHost = host;
    return coordinator;
}
exports.createPlannerOnDemandCoordinatorFromAdapter = createPlannerOnDemandCoordinatorFromAdapter;
async function stopPlannerOnDemandCoordinator() {
    const coordinator = activeCoordinator;
    activeCoordinator = null;
    activeAdapterHost = null;
    if (coordinator) {
        await coordinator.stop();
    }
    runtimeContext = null;
    runtimeLoadPromise = null;
}
exports.stopPlannerOnDemandCoordinator = stopPlannerOnDemandCoordinator;
function createPlannerOnDemandCoordinatorForTest(deps, options) {
    return new coordinator_1.PlannerOnDemandCoordinator(deps, options);
}
exports.createPlannerOnDemandCoordinatorForTest = createPlannerOnDemandCoordinatorForTest;
/** Test hook: register an active coordinator without loading runtime modules. */
function registerPlannerOnDemandCoordinatorForTest(coordinator) {
    if (activeCoordinator) {
        const state = activeCoordinator.getStatus().state;
        if (state !== "stopped") {
            throw new PlannerCoordinatorAlreadyActiveError();
        }
    }
    activeCoordinator = coordinator;
}
exports.registerPlannerOnDemandCoordinatorForTest = registerPlannerOnDemandCoordinatorForTest;
/** Test hook: inspect whether runtime modules were loaded via lazy factory. */
function isPlannerRuntimeContextLoadedForTest() {
    return runtimeContext !== null || runtimeLoadPromise !== null;
}
exports.isPlannerRuntimeContextLoadedForTest = isPlannerRuntimeContextLoadedForTest;
/** Test hook: clear lazy runtime load state without stopping a registered test coordinator. */
function resetPlannerRuntimeLoadStateForTest() {
    runtimeContext = null;
    runtimeLoadPromise = null;
}
exports.resetPlannerRuntimeLoadStateForTest = resetPlannerRuntimeLoadStateForTest;

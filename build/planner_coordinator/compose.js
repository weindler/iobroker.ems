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
exports.isPlannerRuntimeContextLoadedForTest = exports.registerPlannerOnDemandCoordinatorForTest = exports.createPlannerOnDemandCoordinatorForTest = exports.stopPlannerOnDemandCoordinator = exports.createPlannerOnDemandCoordinatorFromAdapter = exports.getPlannerOnDemandCoordinator = exports.PlannerCoordinatorAlreadyActiveError = void 0;
const coordinator_1 = require("./coordinator");
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
async function loadRuntimeContext(host, options) {
    if (runtimeContext) {
        return runtimeContext;
    }
    if (!runtimeLoadPromise) {
        runtimeLoadPromise = Promise.resolve().then(() => __importStar(require("./runtime_factory.js"))).then((module) => module.createPlannerRuntimeContext(host, { packageRoot: options.packageRoot }));
    }
    runtimeContext = await runtimeLoadPromise;
    return runtimeContext;
}
function createLazyRuntimeDependencies(host, options) {
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
    };
}
function createPlannerOnDemandCoordinatorFromAdapter(adapter, options = {}) {
    if (activeCoordinator) {
        const state = activeCoordinator.getStatus().state;
        if (state !== "stopped") {
            throw new PlannerCoordinatorAlreadyActiveError();
        }
    }
    const coordinator = new coordinator_1.PlannerOnDemandCoordinator(createLazyRuntimeDependencies(adapter, options), options);
    activeCoordinator = coordinator;
    activeAdapterHost = adapter;
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

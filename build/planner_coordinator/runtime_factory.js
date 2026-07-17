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
exports.createPlannerRuntimeContext = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const lifecycle_1 = require("../planner_job/lifecycle");
const constants_1 = require("../planner_job/constants");
const validate_1 = require("../planner_preparation/validate");
const paths_2 = require("../planner_paths/paths");
const types_1 = require("../planner_candidate/types");
const build_1 = require("../planner_candidate/build");
const candidate_compare_1 = require("../planner_shadow/candidate_compare");
const compare_1 = require("../planner_shadow/compare");
const repository_1 = require("../planner_repository/repository");
const from_iobroker_1 = require("../planner_snapshot/from_iobroker");
const write_1 = require("../planner_snapshot/write");
const trigger_1 = require("./trigger");
function createPlannerRuntimeContext(adapter, options = {}) {
    const layout = (0, paths_2.resolvePlannerPaths)({
        namespace: adapter.namespace,
        getAbsoluteInstanceDataDir: () => adapter.getAbsoluteInstanceDataDir(),
    });
    const emsPaths = (0, paths_1.resolveEmsPaths)({
        namespace: adapter.namespace,
        getAbsoluteInstanceDataDir: () => adapter.getAbsoluteInstanceDataDir(),
    });
    const repository = new repository_1.PlannerRepository(layout);
    const lifecycle = new lifecycle_1.PlannerJobLifecycle(layout, repository);
    const packageRoot = options.packageRoot ?? path.resolve(__dirname, "..", "..");
    const workerScriptPath = lifecycle.resolveWorkerPath(packageRoot);
    const deps = {
        now: () => new Date(),
        buildSnapshot: () => (0, from_iobroker_1.buildPlannerInputSnapshotFromIoBroker)(adapter),
        isWorkerRunning: () => lifecycle.isRunning(),
        shutdownWorker: () => lifecycle.shutdown(),
        readWorkerResult: async (jobId) => (0, repository_1.readJobResult)(layout.jobDir(jobId)),
        readPreparedOutput: (jobId, expectedInputRevision) => (0, validate_1.readAndValidatePreparedInputFile)(layout.jobDir(jobId), {
            expectedInputRevision,
            runtimeRootDir: layout.runtimePlannerDir,
        }),
        cleanupJob: async (jobId) => {
            // Preserve last candidate under non-canonical candidate area before job cleanup.
            try {
                const src = path.join(layout.jobDir(jobId), types_1.PLANNER_CANDIDATE_FILE);
                const destDir = layout.candidateJobDir(jobId);
                await fs.promises.mkdir(destDir, { recursive: true, mode: 0o700 });
                await fs.promises.copyFile(src, path.join(destDir, types_1.PLANNER_CANDIDATE_FILE));
            }
            catch {
                // absent candidate is fine
            }
            await repository.cleanupJobDir(layout.jobDir(jobId), true);
        },
        runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt, timeoutMs }) => {
            const jobDir = layout.jobDir(jobId);
            await (0, write_1.writePlannerInputSnapshot)(jobDir, snapshot, {
                runtimeRootDir: layout.runtimePlannerDir,
                durableDataDir: emsPaths.durableDataDir,
            });
            const request = {
                schemaVersion: 1,
                kind: "planner_snapshot_v2",
                jobId,
                generation,
                trigger: (0, trigger_1.triggerToJobTrigger)(triggerReason),
                mode: "simulation",
                requestedAt,
                timeoutMs: timeoutMs ?? constants_1.PLANNER_DEFAULT_JOB_TIMEOUT_MS,
                inputSnapshotPath: path.join(jobDir, "input.json"),
            };
            const runResult = await lifecycle.runJob({
                request,
                input: snapshot,
                workerScriptPath,
                timeoutMs,
            });
            const result = await (0, repository_1.readJobResult)(jobDir);
            const merged = { ...runResult, result };
            return merged;
        },
        compareShadowOutput: ({ snapshot, prepared, jobId }) => {
            if (!jobId) {
                return (0, compare_1.compareSnapshotPreparedInput)(snapshot, prepared).result;
            }
            try {
                const reference = (0, build_1.buildPlanCandidateFromSnapshot)(snapshot).candidate;
                const raw = fs.readFileSync(path.join(layout.jobDir(jobId), types_1.PLANNER_CANDIDATE_FILE), "utf8");
                const worker = JSON.parse(raw);
                return (0, candidate_compare_1.comparePlanCandidates)(reference, worker);
            }
            catch {
                return {
                    status: "worker_failed",
                    mismatchCount: 0,
                    mismatchedSlotCount: 0,
                    firstMismatchPath: "candidate_read",
                };
            }
        },
    };
    return { deps, lifecycle };
}
exports.createPlannerRuntimeContext = createPlannerRuntimeContext;

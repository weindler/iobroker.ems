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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const paths_js_1 = require("../backup_integration/paths.js");
const lifecycle_js_1 = require("../planner_job/lifecycle.js");
const constants_js_1 = require("../planner_job/constants.js");
const validate_js_1 = require("../planner_preparation/validate.js");
const constants_js_2 = require("../planner_preparation/constants.js");
const paths_js_2 = require("../planner_paths/paths.js");
const repository_js_1 = require("../planner_repository/repository.js");
const builder_js_1 = require("../planner_snapshot/builder.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
const write_js_1 = require("../planner_snapshot/write.js");
const trigger_js_1 = require("./trigger.js");
const compose_js_1 = require("./compose.js");
(0, node_test_1.describe)("planner_coordinator integration", () => {
    (0, node_test_1.it)("runs real worker process and validates prepared output", async () => {
        const root = path.join(os.tmpdir(), `ems-coord-int-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)(durable);
        const repository = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repository);
        const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
        let workerCalls = 0;
        const deps = {
            now: () => new Date("2026-07-01T12:00:00.000Z"),
            buildSnapshot: () => (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)()),
            isWorkerRunning: () => lifecycle.isRunning(),
            shutdownWorker: () => lifecycle.shutdown(),
            readWorkerResult: (jobId) => (0, repository_js_1.readJobResult)(layout.jobDir(jobId)),
            readPreparedOutput: (jobId, expectedInputRevision) => (0, validate_js_1.readAndValidatePreparedInputFile)(layout.jobDir(jobId), {
                expectedInputRevision,
                runtimeRootDir: layout.runtimePlannerDir,
            }),
            cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), false),
            runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt }) => {
                workerCalls += 1;
                const jobDir = layout.jobDir(jobId);
                await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snapshot, {
                    runtimeRootDir: layout.runtimePlannerDir,
                    durableDataDir: durable,
                });
                const runResult = await lifecycle.runJob({
                    request: {
                        schemaVersion: 1,
                        kind: "planner_snapshot_v2",
                        jobId,
                        generation,
                        trigger: (0, trigger_js_1.triggerToJobTrigger)(triggerReason),
                        mode: "simulation",
                        requestedAt,
                        timeoutMs: constants_js_1.PLANNER_DEFAULT_JOB_TIMEOUT_MS,
                        inputSnapshotPath: path.join(jobDir, "input.json"),
                    },
                    input: snapshot,
                    workerScriptPath,
                });
                return { ...runResult, result: await (0, repository_js_1.readJobResult)(jobDir) };
            },
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
        strict_1.default.equal(outcome.result, "success");
        strict_1.default.equal(workerCalls, 1);
        strict_1.default.ok(outcome.preparationRevision);
        strict_1.default.equal(coordinator.hasActiveJobReference(), false);
        strict_1.default.equal(coordinator.getRetainedPayloadBytes(), 0);
        strict_1.default.equal(lifecycle.isRunning(), false);
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "success");
        strict_1.default.ok(!JSON.stringify(status).includes("slots15Min"));
        await coordinator.stop();
        await fs.rm(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("cleans up temp files after integration run", async () => {
        const root = path.join(os.tmpdir(), `ems-coord-clean-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)(durable);
        const repository = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repository);
        const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
        let lastJobId = "";
        const deps = {
            now: () => new Date("2026-07-01T12:00:00.000Z"),
            buildSnapshot: () => (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)()),
            isWorkerRunning: () => lifecycle.isRunning(),
            shutdownWorker: () => lifecycle.shutdown(),
            readWorkerResult: (jobId) => (0, repository_js_1.readJobResult)(layout.jobDir(jobId)),
            readPreparedOutput: (jobId, expectedInputRevision) => (0, validate_js_1.readAndValidatePreparedInputFile)(layout.jobDir(jobId), {
                expectedInputRevision,
                runtimeRootDir: layout.runtimePlannerDir,
            }),
            cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), true),
            runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt }) => {
                lastJobId = jobId;
                const jobDir = layout.jobDir(jobId);
                await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snapshot, {
                    runtimeRootDir: layout.runtimePlannerDir,
                    durableDataDir: durable,
                });
                const runResult = await lifecycle.runJob({
                    request: {
                        schemaVersion: 1,
                        kind: "planner_snapshot_v2",
                        jobId,
                        generation,
                        trigger: (0, trigger_js_1.triggerToJobTrigger)(triggerReason),
                        mode: "simulation",
                        requestedAt,
                        timeoutMs: constants_js_1.PLANNER_DEFAULT_JOB_TIMEOUT_MS,
                        inputSnapshotPath: path.join(jobDir, "input.json"),
                    },
                    input: snapshot,
                    workerScriptPath,
                });
                return { ...runResult, result: await (0, repository_js_1.readJobResult)(jobDir) };
            },
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
        const jobDir = layout.jobDir(lastJobId);
        await strict_1.default.rejects(() => fs.access(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE)));
        const tmpEntries = await fs.readdir(jobDir).catch(() => []);
        strict_1.default.ok(!tmpEntries.some((name) => name.endsWith(".tmp")));
        strict_1.default.equal(lifecycle.isRunning(), false);
        await fs.rm(root, { recursive: true, force: true });
    });
});

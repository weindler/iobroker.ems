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
const paths_js_2 = require("../planner_paths/paths.js");
const repository_js_1 = require("../planner_repository/repository.js");
const builder_js_1 = require("../planner_snapshot/builder.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
const write_js_1 = require("../planner_snapshot/write.js");
const compose_js_1 = require("../planner_coordinator/compose.js");
const trigger_js_1 = require("../planner_coordinator/trigger.js");
const compare_js_1 = require("./compare.js");
const ensure_states_js_1 = require("./ensure_states.js");
const runtime_js_1 = require("./runtime.js");
function memoryHost() {
    const states = new Map();
    return {
        namespace: "ems.0",
        log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
        getStateAsync: async (id) => (states.has(id) ? states.get(id) : null),
        setStateAsync: async (id, state) => {
            states.set(id, { val: state.val, ack: state.ack ?? true });
        },
        setObjectNotExistsAsync: async () => undefined,
        subscribeStatesAsync: async () => undefined,
        unsubscribeStatesAsync: async () => undefined,
        states,
    };
}
(0, node_test_1.describe)("planner_shadow integration", () => {
    (0, node_test_1.it)("matched end-to-end shadow run with real worker and compact states", async () => {
        const root = path.join(os.tmpdir(), `ems-shadow-int-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => durable,
        });
        const repository = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repository);
        const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
        const host = memoryHost();
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
            compareShadowOutput: ({ snapshot, prepared }) => (0, compare_js_1.compareSnapshotPreparedInput)(snapshot, prepared).result,
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await host.setStateAsync(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, { val: true, ack: false });
        await host.setStateAsync(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, { val: true, ack: false });
        const { handlePlannerShadowStateChange } = await Promise.resolve().then(() => __importStar(require("./runtime.js")));
        await handlePlannerShadowStateChange(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await handlePlannerShadowStateChange(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
        await new Promise((r) => setTimeout(r, 100));
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "success");
        strict_1.default.equal(status.comparisonStatus, "matched");
        strict_1.default.equal(lifecycle.isRunning(), false);
        strict_1.default.equal(host.states.get(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.comparisonStatus)?.val, "matched");
        strict_1.default.ok(!JSON.stringify(Object.fromEntries(host.states)).includes("slots15Min"));
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
        await fs.rm(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("mismatch integration when worker projection differs from in-process reference", async () => {
        const root = path.join(os.tmpdir(), `ems-shadow-mismatch-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => durable,
        });
        const repository = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repository);
        const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
        const host = memoryHost();
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const deps = {
            now: () => new Date("2026-07-01T12:00:00.000Z"),
            buildSnapshot: async () => snapshot,
            isWorkerRunning: () => lifecycle.isRunning(),
            shutdownWorker: () => lifecycle.shutdown(),
            readWorkerResult: (jobId) => (0, repository_js_1.readJobResult)(layout.jobDir(jobId)),
            readPreparedOutput: (jobId, expectedInputRevision) => (0, validate_js_1.readAndValidatePreparedInputFile)(layout.jobDir(jobId), {
                expectedInputRevision,
                runtimeRootDir: layout.runtimePlannerDir,
            }),
            cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), true),
            runWorkerJob: async ({ jobId, generation, snapshot: snap, triggerReason, requestedAt }) => {
                const jobDir = layout.jobDir(jobId);
                await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snap, {
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
                    input: snap,
                    workerScriptPath,
                });
                return { ...runResult, result: await (0, repository_js_1.readJobResult)(jobDir) };
            },
            compareShadowOutput: () => ({
                status: "mismatch",
                referenceRevision: "a".repeat(64),
                workerRevision: "b".repeat(64),
                mismatchCount: 1,
                firstMismatchPath: "slots[0].maxImportW",
            }),
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        const { handlePlannerShadowStateChange } = await Promise.resolve().then(() => __importStar(require("./runtime.js")));
        await handlePlannerShadowStateChange(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await handlePlannerShadowStateChange(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
        await new Promise((r) => setTimeout(r, 100));
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "success");
        strict_1.default.equal(status.comparisonStatus, "mismatch");
        strict_1.default.equal(status.comparisonMismatchCount, 1);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
        await fs.rm(root, { recursive: true, force: true });
    });
});

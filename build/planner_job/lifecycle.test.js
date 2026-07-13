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
const paths_js_2 = require("../planner_paths/paths.js");
const repository_js_1 = require("../planner_repository/repository.js");
const lifecycle_js_1 = require("./lifecycle.js");
function seedPlan(rev) {
    const ts = new Date().toISOString();
    return {
        forecast: {
            schema_version: 1,
            revision: rev,
            generated_at: ts,
            status: "ready",
            horizon_start: ts,
            horizon_end: ts,
            slot_minutes: 15,
            slots: [],
        },
        daily: {
            schema_version: 1,
            revision: rev,
            generated_at: ts,
            status: "ready",
            date: ts.slice(0, 10),
            valid_until: null,
            allocations: [],
        },
    };
}
(0, node_test_1.describe)("planner_job lifecycle", () => {
    (0, node_test_1.it)("starts worker, publishes, and leaves no child process", async () => {
        const root = path.join(os.tmpdir(), `ems-planner-life-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        const repo = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repo);
        const workerPath = path.join(process.cwd(), "build", "planner_worker", "main.js");
        const result = await lifecycle.runJob({
            workerScriptPath: workerPath,
            request: {
                schemaVersion: 1,
                jobId: `job-${Date.now()}`,
                generation: 1,
                trigger: "manual",
                mode: "publish",
                requestedAt: new Date().toISOString(),
                timeoutMs: 30_000,
                inputSnapshotPath: path.join(layout.runtimeJobsDir, "input.json"),
            },
            input: {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
            },
        });
        strict_1.default.equal(lifecycle.isRunning(), false);
        strict_1.default.equal(result.timedOut, false);
        strict_1.default.equal(result.exitCode, 0);
        strict_1.default.equal(result.published, true);
        strict_1.default.ok(result.stdoutBytes <= 32 * 1024);
        strict_1.default.ok(result.stderrBytes <= 32 * 1024);
        const forecast = await repo.readCanonicalForecastPlan();
        strict_1.default.ok(forecast);
    });
    (0, node_test_1.it)("does not publish on timeout and preserves last canonical plan", async () => {
        const root = path.join(os.tmpdir(), `ems-planner-timeout-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        const repo = new repository_js_1.PlannerRepository(layout);
        const { forecast, daily } = seedPlan(42);
        await repo.writeSeedCanonicalPlans(forecast, daily);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repo);
        // Slow worker script: sleep via node -e
        const slowWorker = path.join(root, "slow_worker.js");
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(slowWorker, `setTimeout(() => process.exit(0), 3000);`);
        const result = await lifecycle.runJob({
            workerScriptPath: slowWorker,
            timeoutMs: 200,
            request: {
                schemaVersion: 1,
                jobId: `slow-${Date.now()}`,
                generation: 1,
                trigger: "manual",
                mode: "publish",
                requestedAt: new Date().toISOString(),
                timeoutMs: 200,
                inputSnapshotPath: path.join(layout.runtimeJobsDir, "input.json"),
            },
            input: {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
            },
        });
        strict_1.default.equal(result.timedOut, true);
        strict_1.default.equal(result.published, false);
        const kept = await repo.readCanonicalForecastPlan();
        strict_1.default.equal(kept?.revision, 42);
    });
    (0, node_test_1.it)("shutdown kills running worker", async () => {
        const root = path.join(os.tmpdir(), `ems-planner-shutdown-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        const repo = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repo);
        const slowWorker = path.join(root, "hang_worker.js");
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(slowWorker, `setInterval(() => {}, 1000);`);
        const runPromise = lifecycle.runJob({
            workerScriptPath: slowWorker,
            timeoutMs: 60_000,
            request: {
                schemaVersion: 1,
                jobId: `hang-${Date.now()}`,
                generation: 1,
                trigger: "manual",
                mode: "publish",
                requestedAt: new Date().toISOString(),
                timeoutMs: 60_000,
                inputSnapshotPath: path.join(layout.runtimeJobsDir, "input.json"),
            },
            input: {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
            },
        });
        await new Promise((r) => setTimeout(r, 300));
        strict_1.default.equal(lifecycle.isRunning(), true);
        await lifecycle.shutdown();
        const result = await runPromise;
        strict_1.default.equal(lifecycle.isRunning(), false);
        strict_1.default.equal(result.published, false);
    });
    (0, node_test_1.it)("rejects parallel second job", async () => {
        const root = path.join(os.tmpdir(), `ems-planner-parallel-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        const repo = new repository_js_1.PlannerRepository(layout);
        const lifecycle = new lifecycle_js_1.PlannerJobLifecycle(layout, repo);
        const slowWorker = path.join(root, "parallel_slow.js");
        await fs.mkdir(root, { recursive: true });
        await fs.writeFile(slowWorker, `setTimeout(() => process.exit(0), 2000);`);
        const first = lifecycle.runJob({
            workerScriptPath: slowWorker,
            timeoutMs: 10_000,
            request: {
                schemaVersion: 1,
                jobId: "parallel-1",
                generation: 1,
                trigger: "manual",
                mode: "publish",
                requestedAt: new Date().toISOString(),
                timeoutMs: 10_000,
                inputSnapshotPath: path.join(layout.runtimeJobsDir, "input.json"),
            },
            input: {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
            },
        });
        await new Promise((r) => setTimeout(r, 100));
        await strict_1.default.rejects(() => lifecycle.runJob({
            workerScriptPath: slowWorker,
            request: {
                schemaVersion: 1,
                jobId: "parallel-2",
                generation: 1,
                trigger: "manual",
                mode: "publish",
                requestedAt: new Date().toISOString(),
                timeoutMs: 10_000,
                inputSnapshotPath: path.join(layout.runtimeJobsDir, "input.json"),
            },
            input: {
                schemaVersion: 1,
                capturedAt: new Date().toISOString(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
            },
        }), /planner worker already running/);
        await lifecycle.shutdown();
        await first;
    });
});

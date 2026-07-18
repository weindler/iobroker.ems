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
const node_child_process_1 = require("node:child_process");
const paths_js_1 = require("../backup_integration/paths.js");
const paths_js_2 = require("../planner_paths/paths.js");
const constants_js_1 = require("../planner_paths/constants.js");
const constants_js_2 = require("../planner_preparation/constants.js");
const builder_js_1 = require("../planner_snapshot/builder.js");
const canonical_js_1 = require("../planner_snapshot/canonical.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
const write_js_1 = require("../planner_snapshot/write.js");
const validate_js_1 = require("../planner_preparation/validate.js");
const worker_job_js_1 = require("./worker_job.js");
const node_fs_1 = require("node:fs");
function jobRequest(overrides = {}) {
    return {
        schemaVersion: 1,
        kind: "planner_snapshot_v2",
        jobId: "job-test",
        generation: 1,
        trigger: "manual",
        mode: "publish",
        requestedAt: new Date().toISOString(),
        timeoutMs: 30_000,
        inputSnapshotPath: "input.json",
        ...overrides,
    };
}
(0, node_test_1.describe)("planner_worker job", () => {
    (0, node_test_1.it)("runs preparation for v2 snapshot in-process", async () => {
        const root = path.join(os.tmpdir(), `ems-worker-prep-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)(durable);
        const jobDir = layout.jobDir("job-prep-1");
        await fs.mkdir(jobDir, { recursive: true });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snapshot, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), `${JSON.stringify(jobRequest({
            kind: "planner_snapshot_v2",
            jobId: "job-prep-1",
            requestedAt: snapshot.capturedAt,
            inputSnapshotPath: path.join(jobDir, constants_js_1.JOB_INPUT_FILE),
        }))}\n`, { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir, { runtimePlannerDir: layout.runtimePlannerDir });
        strict_1.default.equal(outcome.exitCode, 0);
        const prepared = JSON.parse(await fs.readFile(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE), "utf8"));
        strict_1.default.ok(prepared.slots.length >= 1);
        strict_1.default.equal(prepared.inputRevision, snapshot.inputRevision);
    });
    (0, node_test_1.it)("builder and worker compute identical inputRevision", async () => {
        const root = path.join(os.tmpdir(), `ems-worker-rev-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)(durable);
        const jobDir = layout.jobDir("job-rev");
        await fs.mkdir(jobDir, { recursive: true });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const inputPath = path.join(jobDir, constants_js_1.JOB_INPUT_FILE);
        await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snapshot, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        });
        const fromWorker = await (0, validate_js_1.readAndValidatePlannerInputFile)(inputPath);
        strict_1.default.equal(fromWorker.inputRevision, snapshot.inputRevision);
        strict_1.default.equal(fromWorker.inputRevision, (0, canonical_js_1.computeInputRevision)({ ...snapshot, inputRevision: "" }));
    });
    (0, node_test_1.it)("rejects wrong schema version for planner_snapshot_v2", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-bad-schema-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), JSON.stringify({ schemaVersion: 99 }), {
            mode: 0o600,
        });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        strict_1.default.match(outcome.message, /invalid_schema_version/);
    });
    (0, node_test_1.it)("rejects manipulated inputRevision", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-bad-rev-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        snapshot.inputRevision = "f".repeat(64);
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`, {
            mode: 0o600,
        });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        strict_1.default.match(outcome.message, /input_revision_mismatch/);
    });
    (0, node_test_1.it)("rejects oversized input", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-big-input-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const huge = { ...snapshot, padding: "x".repeat(250_000) };
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), `${JSON.stringify(huge)}\n`, {
            mode: 0o600,
        });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        strict_1.default.match(outcome.message, /input_budget_exceeded|exceeds budget/);
    });
    (0, node_test_1.it)("invalid v2 snapshot does not fall back to legacy v1", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-no-fallback-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), JSON.stringify({
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            timezone: "Europe/Berlin",
            globalMode: "balanced",
        }), { mode: 0o600 });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        strict_1.default.match(outcome.message, /invalid_schema_version/);
    });
    (0, node_test_1.it)("rejects v1 input without explicit legacy_stub job kind", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-v1-no-kind-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), JSON.stringify({
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            timezone: "Europe/Berlin",
            globalMode: "balanced",
        }), { mode: 0o600 });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        await strict_1.default.rejects(() => fs.access(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE)));
    });
    (0, node_test_1.it)("rejects request without job kind", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-no-kind-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), JSON.stringify({ schemaVersion: 2, capturedAt: new Date().toISOString() }), { mode: 0o600 });
        const { kind: _removed, ...withoutKind } = jobRequest();
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(withoutKind), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        strict_1.default.match(outcome.message, /invalid kind/);
    });
    (0, node_test_1.it)("legacy_stub accepts v1 stub without prepared output", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-v1-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), JSON.stringify({
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            timezone: "Europe/Berlin",
            globalMode: "balanced",
        }), { mode: 0o600 });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "legacy_stub", jobId: "v1" })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 0);
        await strict_1.default.rejects(() => fs.access(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE)));
        const result = JSON.parse(await fs.readFile(path.join(jobDir, constants_js_1.JOB_RESULT_FILE), "utf8"));
        strict_1.default.equal(result.summary.quality.forecast, "test");
        strict_1.default.ok(!result.files.some((f) => f.fileName === constants_js_2.PLANNER_PREPARED_INPUT_FILE));
    });
    (0, node_test_1.it)("removes stale prepared output when v2 job fails", async () => {
        const jobDir = path.join(os.tmpdir(), `ems-worker-stale-${Date.now()}`, "job");
        await fs.mkdir(jobDir, { recursive: true });
        await fs.writeFile(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE), JSON.stringify({ schemaVersion: 1, inputRevision: "stale" }), { mode: 0o600 });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        snapshot.inputRevision = "f".repeat(64);
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_INPUT_FILE), `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })), { mode: 0o600 });
        const outcome = await (0, worker_job_js_1.runPlannerWorkerJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 2);
        await strict_1.default.rejects(() => fs.access(path.join(jobDir, constants_js_2.PLANNER_PREPARED_INPUT_FILE)));
    });
    (0, node_test_1.it)("worker module avoids adapter and runtime engine imports", () => {
        const text = (0, node_fs_1.readFileSync)(path.join(process.cwd(), "src/planner_worker/worker_job.ts"), "utf8");
        for (const forbidden of ["adapter-core", "runtime/engine", "ems_light", "operator/forecast/tick"]) {
            strict_1.default.ok(!text.includes(forbidden), `worker_job must not import ${forbidden}`);
        }
    });
});
(0, node_test_1.describe)("planner_worker integration", () => {
    (0, node_test_1.it)("spawns real node worker process for v2 job", async () => {
        const root = path.join(os.tmpdir(), `ems-worker-spawn-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)(durable);
        const jobDir = layout.jobDir(`job-spawn-${Date.now()}`);
        await fs.mkdir(jobDir, { recursive: true });
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snapshot, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        });
        await fs.writeFile(path.join(jobDir, constants_js_1.JOB_REQUEST_FILE), `${JSON.stringify(jobRequest({
            kind: "planner_snapshot_v2",
            jobId: path.basename(jobDir),
            generation: 3,
            requestedAt: snapshot.capturedAt,
            inputSnapshotPath: path.join(jobDir, constants_js_1.JOB_INPUT_FILE),
        }))}\n`, { mode: 0o600 });
        const workerPath = path.join(process.cwd(), "build", "planner_worker", "main.js");
        const exitCode = await new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)(process.execPath, [workerPath, "--job-dir", jobDir], {
                stdio: "ignore",
            });
            child.on("error", reject);
            child.on("close", (code) => resolve(code ?? 2));
        });
        strict_1.default.equal(exitCode, 0);
        const result = JSON.parse(await fs.readFile(path.join(jobDir, constants_js_1.JOB_RESULT_FILE), "utf8"));
        strict_1.default.equal(result.generation, 3);
        strict_1.default.ok(result.files.some((f) => f.fileName === constants_js_2.PLANNER_PREPARED_INPUT_FILE));
    });
});

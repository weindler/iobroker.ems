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
const constants_js_1 = require("../planner_paths/constants.js");
const repository_js_1 = require("./repository.js");
const test_job_js_1 = require("../planner_worker/test_job.js");
const constants_js_2 = require("../planner_contracts/constants.js");
const validate_js_1 = require("../planner_contracts/validate.js");
function sampleForecast(rev = 1) {
    const ts = new Date().toISOString();
    return {
        schema_version: 1,
        revision: rev,
        generated_at: ts,
        status: "ready",
        horizon_start: ts,
        horizon_end: ts,
        slot_minutes: 15,
        slots: [],
    };
}
function sampleDaily(rev = 1) {
    const ts = new Date().toISOString();
    return {
        schema_version: 1,
        revision: rev,
        generated_at: ts,
        status: "ready",
        date: ts.slice(0, 10),
        valid_until: null,
        allocations: [],
    };
}
async function writeJobFiles(jobDir, jobId, generation) {
    const request = {
        schemaVersion: 1,
        kind: "legacy_stub",
        jobId,
        generation,
        trigger: "manual",
        mode: "publish",
        requestedAt: new Date().toISOString(),
        timeoutMs: 30_000,
        inputSnapshotPath: path.join(jobDir, "input.json"),
    };
    const input = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        timezone: "Europe/Berlin",
        globalMode: "balanced",
    };
    await fs.writeFile(path.join(jobDir, "request.json"), JSON.stringify(request));
    await fs.writeFile(path.join(jobDir, "input.json"), JSON.stringify(input));
}
async function makeRepo() {
    const root = path.join(os.tmpdir(), `ems-planner-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
    const layout = (0, paths_js_2.resolvePlannerPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
    return { repo: new repository_js_1.PlannerRepository(layout), layout };
}
(0, node_test_1.describe)("planner_repository", () => {
    (0, node_test_1.it)("publishCurrentJob atomically updates canonical plans", async () => {
        const { repo, layout } = await makeRepo();
        await repo.writeSeedCanonicalPlans(sampleForecast(1), sampleDaily(1));
        const jobId = "publish-ok";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 2);
        const outcome = await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        strict_1.default.equal(outcome.exitCode, 0);
        const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 2, isStale: false });
        strict_1.default.equal(publish.published, true);
        const forecast = await repo.readCanonicalForecastPlan();
        strict_1.default.ok(forecast);
        strict_1.default.equal(forecast.revision, 1);
    });
    (0, node_test_1.it)("rejects wrong job id", async () => {
        const { repo, layout } = await makeRepo();
        const jobId = "wrong-id";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 1);
        await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        const publish = await repo.publishCurrentJob({ jobId: "other-id", expectedGeneration: 1, isStale: false });
        strict_1.default.equal(publish.published, false);
    });
    (0, node_test_1.it)("rejects stale generation", async () => {
        const { repo, layout } = await makeRepo();
        const jobId = "stale-gen";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 1);
        await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 99, isStale: false });
        strict_1.default.equal(publish.published, false);
        strict_1.default.match(publish.reason, /generation_mismatch/);
    });
    (0, node_test_1.it)("rejects explicit stale flag", async () => {
        const { repo, layout } = await makeRepo();
        const jobId = "stale-flag";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 1);
        await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: true });
        strict_1.default.equal(publish.published, false);
        strict_1.default.equal(publish.reason, "stale_generation");
    });
    (0, node_test_1.it)("rejects sha256 mismatch and keeps last valid plan", async () => {
        const { repo, layout } = await makeRepo();
        await repo.writeSeedCanonicalPlans(sampleForecast(5), sampleDaily(5));
        const jobId = "sha-mismatch";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 1);
        await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        const resultPath = path.join(jobDir, constants_js_1.JOB_RESULT_FILE);
        const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
        result.files[0].sha256 = "0".repeat(64);
        await fs.writeFile(resultPath, JSON.stringify(result));
        const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: false });
        strict_1.default.equal(publish.published, false);
        const forecast = await repo.readCanonicalForecastPlan();
        strict_1.default.equal(forecast?.revision, 5);
    });
    (0, node_test_1.it)("rejects schema errors", async () => {
        const { repo, layout } = await makeRepo();
        const jobId = "schema-bad";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        await writeJobFiles(jobDir, jobId, 1);
        await (0, test_job_js_1.runPlannerTestJob)(jobDir);
        await fs.writeFile(path.join(jobDir, constants_js_1.CANONICAL_FORECAST_PLAN_FILE), JSON.stringify({ bad: true }));
        const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: false });
        strict_1.default.equal(publish.published, false);
    });
    (0, node_test_1.it)("rejects result larger than IPC budget", () => {
        const hugePayload = "x".repeat(constants_js_2.PLANNER_IPC_BUDGET_BYTES);
        const raw = {
            schemaVersion: 1,
            jobId: "big",
            generation: 1,
            status: "ok",
            semanticRevision: "abc",
            summary: {
                forecast: { status: "ready", revision: 1, horizonStart: "t", horizonEnd: "t", reasonDe: hugePayload },
                daily: { status: "ready", revision: 1, date: "2026-01-01", validUntil: null, reasonDe: "x" },
                quality: { forecast: "ok", daily: "ok" },
            },
            allocations: [],
            files: [],
        };
        const check = (0, validate_js_1.validatePlannerWorkerResult)(raw);
        strict_1.default.equal(check.valid, false);
    });
    (0, node_test_1.it)("simulation does not overwrite canonical files", async () => {
        const { repo, layout } = await makeRepo();
        await repo.writeSeedCanonicalPlans(sampleForecast(7), sampleDaily(7));
        await repo.writeSimulationArtifacts("sim-1", JSON.stringify(sampleForecast(99)), JSON.stringify(sampleDaily(99)));
        const forecast = await repo.readCanonicalForecastPlan();
        strict_1.default.equal(forecast?.revision, 7);
        const simForecast = await fs.readFile(path.join(layout.simulationDir("sim-1"), constants_js_1.CANONICAL_FORECAST_PLAN_FILE), "utf8");
        strict_1.default.match(simForecast, /"revision":\s*99/);
    });
    (0, node_test_1.it)("validateJobOutput requires complete files", async () => {
        const { repo, layout } = await makeRepo();
        const jobId = "incomplete";
        const jobDir = layout.jobDir(jobId);
        await fs.mkdir(jobDir, { recursive: true });
        const validation = await repo.validateJobOutput(jobId);
        strict_1.default.equal(validation.valid, false);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import {
	CANONICAL_DAILY_PLAN_FILE,
	CANONICAL_FORECAST_PLAN_FILE,
	JOB_RESULT_FILE,
} from "../planner_paths/constants.js";
import { PlannerRepository } from "./repository.js";
import type { CanonicalDailyPlanV1, CanonicalForecastPlanV1 } from "./schema.js";
import { runPlannerTestJob } from "../planner_worker/test_job.js";
import { PLANNER_IPC_BUDGET_BYTES } from "../planner_contracts/constants.js";
import { validatePlannerWorkerResult } from "../planner_contracts/validate.js";

function sampleForecast(rev = 1): CanonicalForecastPlanV1 {
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

function sampleDaily(rev = 1): CanonicalDailyPlanV1 {
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

async function writeJobFiles(jobDir: string, jobId: string, generation: number): Promise<void> {
	const request = {
		schemaVersion: 1 as const,
		jobId,
		generation,
		trigger: "manual" as const,
		mode: "publish" as const,
		requestedAt: new Date().toISOString(),
		timeoutMs: 30_000,
		inputSnapshotPath: path.join(jobDir, "input.json"),
	};
	const input = {
		schemaVersion: 1 as const,
		capturedAt: new Date().toISOString(),
		timezone: "Europe/Berlin",
		globalMode: "balanced",
	};
	await fs.writeFile(path.join(jobDir, "request.json"), JSON.stringify(request));
	await fs.writeFile(path.join(jobDir, "input.json"), JSON.stringify(input));
}

async function makeRepo(): Promise<{ repo: PlannerRepository; layout: ReturnType<typeof resolvePlannerPaths> }> {
	const root = path.join(os.tmpdir(), `ems-planner-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const durable = durableDataDirFromRoot(root, 0);
	const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
	return { repo: new PlannerRepository(layout), layout };
}

describe("planner_repository", () => {
	it("publishCurrentJob atomically updates canonical plans", async () => {
		const { repo, layout } = await makeRepo();
		await repo.writeSeedCanonicalPlans(sampleForecast(1), sampleDaily(1));

		const jobId = "publish-ok";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 2);
		const outcome = await runPlannerTestJob(jobDir);
		assert.equal(outcome.exitCode, 0);

		const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 2, isStale: false });
		assert.equal(publish.published, true);

		const forecast = await repo.readCanonicalForecastPlan();
		assert.ok(forecast);
		assert.equal(forecast.revision, 1);
	});

	it("rejects wrong job id", async () => {
		const { repo, layout } = await makeRepo();
		const jobId = "wrong-id";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 1);
		await runPlannerTestJob(jobDir);
		const publish = await repo.publishCurrentJob({ jobId: "other-id", expectedGeneration: 1, isStale: false });
		assert.equal(publish.published, false);
	});

	it("rejects stale generation", async () => {
		const { repo, layout } = await makeRepo();
		const jobId = "stale-gen";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 1);
		await runPlannerTestJob(jobDir);
		const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 99, isStale: false });
		assert.equal(publish.published, false);
		assert.match(publish.reason, /generation_mismatch/);
	});

	it("rejects explicit stale flag", async () => {
		const { repo, layout } = await makeRepo();
		const jobId = "stale-flag";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 1);
		await runPlannerTestJob(jobDir);
		const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: true });
		assert.equal(publish.published, false);
		assert.equal(publish.reason, "stale_generation");
	});

	it("rejects sha256 mismatch and keeps last valid plan", async () => {
		const { repo, layout } = await makeRepo();
		await repo.writeSeedCanonicalPlans(sampleForecast(5), sampleDaily(5));
		const jobId = "sha-mismatch";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 1);
		await runPlannerTestJob(jobDir);
		const resultPath = path.join(jobDir, JOB_RESULT_FILE);
		const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
		result.files[0].sha256 = "0".repeat(64);
		await fs.writeFile(resultPath, JSON.stringify(result));
		const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: false });
		assert.equal(publish.published, false);
		const forecast = await repo.readCanonicalForecastPlan();
		assert.equal(forecast?.revision, 5);
	});

	it("rejects schema errors", async () => {
		const { repo, layout } = await makeRepo();
		const jobId = "schema-bad";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		await writeJobFiles(jobDir, jobId, 1);
		await runPlannerTestJob(jobDir);
		await fs.writeFile(path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE), JSON.stringify({ bad: true }));
		const publish = await repo.publishCurrentJob({ jobId, expectedGeneration: 1, isStale: false });
		assert.equal(publish.published, false);
	});

	it("rejects result larger than IPC budget", () => {
		const hugePayload = "x".repeat(PLANNER_IPC_BUDGET_BYTES);
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
		const check = validatePlannerWorkerResult(raw);
		assert.equal(check.valid, false);
	});

	it("simulation does not overwrite canonical files", async () => {
		const { repo, layout } = await makeRepo();
		await repo.writeSeedCanonicalPlans(sampleForecast(7), sampleDaily(7));
		await repo.writeSimulationArtifacts(
			"sim-1",
			JSON.stringify(sampleForecast(99)),
			JSON.stringify(sampleDaily(99)),
		);
		const forecast = await repo.readCanonicalForecastPlan();
		assert.equal(forecast?.revision, 7);
		const simForecast = await fs.readFile(
			path.join(layout.simulationDir("sim-1"), CANONICAL_FORECAST_PLAN_FILE),
			"utf8",
		);
		assert.match(simForecast, /"revision":\s*99/);
	});

	it("validateJobOutput requires complete files", async () => {
		const { repo, layout } = await makeRepo();
		const jobId = "incomplete";
		const jobDir = layout.jobDir(jobId);
		await fs.mkdir(jobDir, { recursive: true });
		const validation = await repo.validateJobOutput(jobId);
		assert.equal(validation.valid, false);
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import { PlannerRepository } from "../planner_repository/repository.js";
import { PlannerJobLifecycle } from "./lifecycle.js";
import type { CanonicalDailyPlanV1, CanonicalForecastPlanV1 } from "../planner_repository/schema.js";

function seedPlan(rev: number): { forecast: CanonicalForecastPlanV1; daily: CanonicalDailyPlanV1 } {
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

describe("planner_job lifecycle", () => {
	it("starts worker, publishes, and leaves no child process", async () => {
		const root = path.join(os.tmpdir(), `ems-planner-life-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		const repo = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repo);
		const workerPath = path.join(process.cwd(), "build", "planner_worker", "main.js");

		const result = await lifecycle.runJob({
			workerScriptPath: workerPath,
			request: {
				schemaVersion: 1,
				kind: "legacy_stub",
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

		assert.equal(lifecycle.isRunning(), false);
		assert.equal(result.timedOut, false);
		assert.equal(result.exitCode, 0);
		assert.equal(result.published, true);
		assert.ok(result.stdoutBytes <= 32 * 1024);
		assert.ok(result.stderrBytes <= 32 * 1024);

		const forecast = await repo.readCanonicalForecastPlan();
		assert.ok(forecast);
	});

	it("does not publish on timeout and preserves last canonical plan", async () => {
		const root = path.join(os.tmpdir(), `ems-planner-timeout-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		const repo = new PlannerRepository(layout);
		const { forecast, daily } = seedPlan(42);
		await repo.writeSeedCanonicalPlans(forecast, daily);
		const lifecycle = new PlannerJobLifecycle(layout, repo);

		// Slow worker script: sleep via node -e
		const slowWorker = path.join(root, "slow_worker.js");
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(
			slowWorker,
			`setTimeout(() => process.exit(0), 3000);`,
		);

		const result = await lifecycle.runJob({
			workerScriptPath: slowWorker,
			timeoutMs: 200,
			request: {
				schemaVersion: 1,
				kind: "legacy_stub",
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

		assert.equal(result.timedOut, true);
		assert.equal(result.published, false);
		const kept = await repo.readCanonicalForecastPlan();
		assert.equal(kept?.revision, 42);
	});

	it("shutdown kills running worker", async () => {
		const root = path.join(os.tmpdir(), `ems-planner-shutdown-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		const repo = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repo);
		const slowWorker = path.join(root, "hang_worker.js");
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(slowWorker, `setInterval(() => {}, 1000);`);

		const runPromise = lifecycle.runJob({
			workerScriptPath: slowWorker,
			timeoutMs: 60_000,
			request: {
				schemaVersion: 1,
				kind: "legacy_stub",
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
		assert.equal(lifecycle.isRunning(), true);
		await lifecycle.shutdown();
		const result = await runPromise;
		assert.equal(lifecycle.isRunning(), false);
		assert.equal(result.published, false);
	});

	it("rejects parallel second job", async () => {
		const root = path.join(os.tmpdir(), `ems-planner-parallel-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		const repo = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repo);
		const slowWorker = path.join(root, "parallel_slow.js");
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(slowWorker, `setTimeout(() => process.exit(0), 2000);`);

		const first = lifecycle.runJob({
			workerScriptPath: slowWorker,
			timeoutMs: 10_000,
			request: {
				schemaVersion: 1,
				kind: "legacy_stub",
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
		await assert.rejects(
			() =>
				lifecycle.runJob({
					workerScriptPath: slowWorker,
					request: {
						schemaVersion: 1,
						kind: "legacy_stub",
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
				}),
			/planner worker already running/,
		);
		await lifecycle.shutdown();
		await first;
	});
});

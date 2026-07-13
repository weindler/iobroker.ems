import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import { JOB_INPUT_FILE, JOB_REQUEST_FILE, JOB_RESULT_FILE } from "../planner_paths/constants.js";
import { PLANNER_PREPARED_INPUT_FILE } from "../planner_preparation/constants.js";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { computeInputRevision } from "../planner_snapshot/canonical.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";
import { writePlannerInputSnapshot } from "../planner_snapshot/write.js";
import { readAndValidatePlannerInputFile } from "../planner_preparation/validate.js";
import { runPlannerWorkerJob } from "./worker_job.js";
import { readFileSync } from "node:fs";

function jobRequest(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

describe("planner_worker job", () => {
	it("runs preparation for v2 snapshot in-process", async () => {
		const root = path.join(os.tmpdir(), `ems-worker-prep-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const jobDir = layout.jobDir("job-prep-1");
		await fs.mkdir(jobDir, { recursive: true });

		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		await writePlannerInputSnapshot(jobDir, snapshot, {
			runtimeRootDir: layout.runtimePlannerDir,
			durableDataDir: durable,
		});

		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			`${JSON.stringify(
				jobRequest({
					kind: "planner_snapshot_v2",
					jobId: "job-prep-1",
					requestedAt: snapshot.capturedAt,
					inputSnapshotPath: path.join(jobDir, JOB_INPUT_FILE),
				}),
			)}\n`,
			{ mode: 0o600 },
		);

		const outcome = await runPlannerWorkerJob(jobDir, { runtimePlannerDir: layout.runtimePlannerDir });
		assert.equal(outcome.exitCode, 0);
		const prepared = JSON.parse(await fs.readFile(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE), "utf8"));
		assert.ok(prepared.slots.length >= 1);
		assert.equal(prepared.inputRevision, snapshot.inputRevision);
	});

	it("builder and worker compute identical inputRevision", async () => {
		const root = path.join(os.tmpdir(), `ems-worker-rev-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const jobDir = layout.jobDir("job-rev");
		await fs.mkdir(jobDir, { recursive: true });

		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const inputPath = path.join(jobDir, JOB_INPUT_FILE);
		await writePlannerInputSnapshot(jobDir, snapshot, {
			runtimeRootDir: layout.runtimePlannerDir,
			durableDataDir: durable,
		});

		const fromWorker = await readAndValidatePlannerInputFile(inputPath);
		assert.equal(fromWorker.inputRevision, snapshot.inputRevision);
		assert.equal(fromWorker.inputRevision, computeInputRevision({ ...snapshot, inputRevision: "" }));
	});

	it("rejects wrong schema version for planner_snapshot_v2", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-bad-schema-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(path.join(jobDir, JOB_INPUT_FILE), JSON.stringify({ schemaVersion: 99 }), {
			mode: 0o600,
		});
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		assert.match(outcome.message, /invalid_schema_version/);
	});

	it("rejects manipulated inputRevision", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-bad-rev-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		snapshot.inputRevision = "f".repeat(64);
		await fs.writeFile(path.join(jobDir, JOB_INPUT_FILE), `${JSON.stringify(snapshot, null, 2)}\n`, {
			mode: 0o600,
		});
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		assert.match(outcome.message, /input_revision_mismatch/);
	});

	it("rejects oversized input", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-big-input-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const huge = { ...snapshot, padding: "x".repeat(250_000) };
		await fs.writeFile(path.join(jobDir, JOB_INPUT_FILE), `${JSON.stringify(huge)}\n`, {
			mode: 0o600,
		});
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		assert.match(outcome.message, /input_budget_exceeded|exceeds budget/);
	});

	it("invalid v2 snapshot does not fall back to legacy v1", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-no-fallback-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(
			path.join(jobDir, JOB_INPUT_FILE),
			JSON.stringify({
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				timezone: "Europe/Berlin",
				globalMode: "balanced",
			}),
			{ mode: 0o600 },
		);
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		assert.match(outcome.message, /invalid_schema_version/);
	});

	it("rejects v1 input without explicit legacy_stub job kind", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-v1-no-kind-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(
			path.join(jobDir, JOB_INPUT_FILE),
			JSON.stringify({
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				timezone: "Europe/Berlin",
				globalMode: "balanced",
			}),
			{ mode: 0o600 },
		);
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2" })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		await assert.rejects(() => fs.access(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE)));
	});

	it("rejects request without job kind", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-no-kind-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(
			path.join(jobDir, JOB_INPUT_FILE),
			JSON.stringify({ schemaVersion: 2, capturedAt: new Date().toISOString() }),
			{ mode: 0o600 },
		);
		const { kind: _removed, ...withoutKind } = jobRequest();
		await fs.writeFile(path.join(jobDir, JOB_REQUEST_FILE), JSON.stringify(withoutKind), { mode: 0o600 });
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		assert.match(outcome.message, /invalid kind/);
	});

	it("legacy_stub accepts v1 stub without prepared output", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-v1-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(
			path.join(jobDir, JOB_INPUT_FILE),
			JSON.stringify({
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				timezone: "Europe/Berlin",
				globalMode: "balanced",
			}),
			{ mode: 0o600 },
		);
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "legacy_stub", jobId: "v1" })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 0);
		await assert.rejects(() => fs.access(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE)));
		const result = JSON.parse(await fs.readFile(path.join(jobDir, JOB_RESULT_FILE), "utf8"));
		assert.equal(result.summary.quality.forecast, "test");
		assert.ok(!result.files.some((f: { fileName: string }) => f.fileName === PLANNER_PREPARED_INPUT_FILE));
	});

	it("removes stale prepared output when v2 job fails", async () => {
		const jobDir = path.join(os.tmpdir(), `ems-worker-stale-${Date.now()}`, "job");
		await fs.mkdir(jobDir, { recursive: true });
		await fs.writeFile(
			path.join(jobDir, PLANNER_PREPARED_INPUT_FILE),
			JSON.stringify({ schemaVersion: 1, inputRevision: "stale" }),
			{ mode: 0o600 },
		);
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		snapshot.inputRevision = "f".repeat(64);
		await fs.writeFile(path.join(jobDir, JOB_INPUT_FILE), `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			JSON.stringify(jobRequest({ kind: "planner_snapshot_v2", requestedAt: snapshot.capturedAt })),
			{ mode: 0o600 },
		);
		const outcome = await runPlannerWorkerJob(jobDir);
		assert.equal(outcome.exitCode, 2);
		await assert.rejects(() => fs.access(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE)));
	});

	it("worker module avoids adapter and runtime engine imports", () => {
		const text = readFileSync(path.join(process.cwd(), "src/planner_worker/worker_job.ts"), "utf8");
		for (const forbidden of ["adapter-core", "runtime/engine", "ems_light", "operator/forecast/tick"]) {
			assert.ok(!text.includes(forbidden), `worker_job must not import ${forbidden}`);
		}
	});
});

describe("planner_worker integration", () => {
	it("spawns real node worker process for v2 job", async () => {
		const root = path.join(os.tmpdir(), `ems-worker-spawn-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const jobDir = layout.jobDir(`job-spawn-${Date.now()}`);
		await fs.mkdir(jobDir, { recursive: true });

		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		await writePlannerInputSnapshot(jobDir, snapshot, {
			runtimeRootDir: layout.runtimePlannerDir,
			durableDataDir: durable,
		});
		await fs.writeFile(
			path.join(jobDir, JOB_REQUEST_FILE),
			`${JSON.stringify(
				jobRequest({
					kind: "planner_snapshot_v2",
					jobId: path.basename(jobDir),
					generation: 3,
					requestedAt: snapshot.capturedAt,
					inputSnapshotPath: path.join(jobDir, JOB_INPUT_FILE),
				}),
			)}\n`,
			{ mode: 0o600 },
		);

		const workerPath = path.join(process.cwd(), "build", "planner_worker", "main.js");
		const exitCode = await new Promise<number>((resolve, reject) => {
			const child = spawn(process.execPath, [workerPath, "--job-dir", jobDir], {
				stdio: "ignore",
			});
			child.on("error", reject);
			child.on("close", (code) => resolve(code ?? 2));
		});
		assert.equal(exitCode, 0);
		const result = JSON.parse(await fs.readFile(path.join(jobDir, JOB_RESULT_FILE), "utf8"));
		assert.equal(result.generation, 3);
		assert.ok(result.files.some((f: { fileName: string }) => f.fileName === PLANNER_PREPARED_INPUT_FILE));
	});
});

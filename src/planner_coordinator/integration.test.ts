import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { PlannerJobLifecycle } from "../planner_job/lifecycle.js";
import { PLANNER_DEFAULT_JOB_TIMEOUT_MS } from "../planner_job/constants.js";
import { readAndValidatePreparedInputFile } from "../planner_preparation/validate.js";
import { PLANNER_PREPARED_INPUT_FILE } from "../planner_preparation/constants.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import { readJobResult, PlannerRepository } from "../planner_repository/repository.js";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";
import { writePlannerInputSnapshot } from "../planner_snapshot/write.js";
import { triggerToJobTrigger } from "./trigger.js";
import { createPlannerOnDemandCoordinatorForTest } from "./compose.js";
import type { PlannerOnDemandCoordinatorDependencies } from "./types.js";

describe("planner_coordinator integration", () => {
	it("runs real worker process and validates prepared output", async () => {
		const root = path.join(os.tmpdir(), `ems-coord-int-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const repository = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repository);
		const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
		let workerCalls = 0;

		const deps: PlannerOnDemandCoordinatorDependencies = {
			now: () => new Date("2026-07-01T12:00:00.000Z"),
			buildSnapshot: () => buildPlannerInputSnapshot(createParityFixtureSource()),
			isWorkerRunning: () => lifecycle.isRunning(),
			shutdownWorker: () => lifecycle.shutdown(),
			readWorkerResult: (jobId) => readJobResult(layout.jobDir(jobId)),
			readPreparedOutput: (jobId, expectedInputRevision) =>
				readAndValidatePreparedInputFile(layout.jobDir(jobId), {
					expectedInputRevision,
					runtimeRootDir: layout.runtimePlannerDir,
				}),
			cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), false),
			runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt }) => {
				workerCalls += 1;
				const jobDir = layout.jobDir(jobId);
				await writePlannerInputSnapshot(jobDir, snapshot, {
					runtimeRootDir: layout.runtimePlannerDir,
					durableDataDir: durable,
				});
				const runResult = await lifecycle.runJob({
					request: {
						schemaVersion: 1,
						kind: "planner_snapshot_v2",
						jobId,
						generation,
						trigger: triggerToJobTrigger(triggerReason),
						mode: "simulation",
						requestedAt,
						timeoutMs: PLANNER_DEFAULT_JOB_TIMEOUT_MS,
						inputSnapshotPath: path.join(jobDir, "input.json"),
					},
					input: snapshot as unknown as import("../planner_contracts/types.js").PlannerInputSnapshot,
					workerScriptPath,
				});
				return { ...runResult, result: await readJobResult(jobDir) };
			},
		};

		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
		assert.equal(outcome.result, "success");
		assert.equal(workerCalls, 1);
		assert.ok(outcome.preparationRevision);
		assert.equal(coordinator.hasActiveJobReference(), false);
		assert.equal(coordinator.getRetainedPayloadBytes(), 0);
		assert.equal(lifecycle.isRunning(), false);

		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.ok(!JSON.stringify(status).includes("slots15Min"));

		await coordinator.stop();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("cleans up temp files after integration run", async () => {
		const root = path.join(os.tmpdir(), `ems-coord-clean-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const repository = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repository);
		const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
		let lastJobId = "";

		const deps: PlannerOnDemandCoordinatorDependencies = {
			now: () => new Date("2026-07-01T12:00:00.000Z"),
			buildSnapshot: () => buildPlannerInputSnapshot(createParityFixtureSource()),
			isWorkerRunning: () => lifecycle.isRunning(),
			shutdownWorker: () => lifecycle.shutdown(),
			readWorkerResult: (jobId) => readJobResult(layout.jobDir(jobId)),
			readPreparedOutput: (jobId, expectedInputRevision) =>
				readAndValidatePreparedInputFile(layout.jobDir(jobId), {
					expectedInputRevision,
					runtimeRootDir: layout.runtimePlannerDir,
				}),
			cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), true),
			runWorkerJob: async ({ jobId, generation, snapshot, triggerReason, requestedAt }) => {
				lastJobId = jobId;
				const jobDir = layout.jobDir(jobId);
				await writePlannerInputSnapshot(jobDir, snapshot, {
					runtimeRootDir: layout.runtimePlannerDir,
					durableDataDir: durable,
				});
				const runResult = await lifecycle.runJob({
					request: {
						schemaVersion: 1,
						kind: "planner_snapshot_v2",
						jobId,
						generation,
						trigger: triggerToJobTrigger(triggerReason),
						mode: "simulation",
						requestedAt,
						timeoutMs: PLANNER_DEFAULT_JOB_TIMEOUT_MS,
						inputSnapshotPath: path.join(jobDir, "input.json"),
					},
					input: snapshot as unknown as import("../planner_contracts/types.js").PlannerInputSnapshot,
					workerScriptPath,
				});
				return { ...runResult, result: await readJobResult(jobDir) };
			},
		};

		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
		const jobDir = layout.jobDir(lastJobId);
		await assert.rejects(() => fs.access(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE)));
		const tmpEntries = await fs.readdir(jobDir).catch(() => [] as string[]);
		assert.ok(!tmpEntries.some((name) => name.endsWith(".tmp")));
		assert.equal(lifecycle.isRunning(), false);
		await fs.rm(root, { recursive: true, force: true });
	});
});

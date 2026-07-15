import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { PlannerJobLifecycle } from "../planner_job/lifecycle.js";
import { PLANNER_DEFAULT_JOB_TIMEOUT_MS } from "../planner_job/constants.js";
import { readAndValidatePreparedInputFile } from "../planner_preparation/validate.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import { readJobResult, PlannerRepository } from "../planner_repository/repository.js";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";
import { writePlannerInputSnapshot } from "../planner_snapshot/write.js";
import {
	createPlannerOnDemandCoordinatorForTest,
	registerPlannerOnDemandCoordinatorForTest,
	stopPlannerOnDemandCoordinator,
} from "../planner_coordinator/compose.js";
import { triggerToJobTrigger } from "../planner_coordinator/trigger.js";
import { compareSnapshotPreparedInput } from "./compare.js";
import { PLANNER_COORDINATOR_STATE_IDS } from "./ensure_states.js";
import { initPlannerShadowRuntime, stopPlannerShadowRuntime } from "./runtime.js";
import type { PlannerShadowRuntimeHost } from "./runtime.js";
import type { PlannerOnDemandCoordinatorDependencies } from "../planner_coordinator/types.js";

type StoredState = { val: ioBroker.StateValue; ack: boolean };

function memoryHost(): PlannerShadowRuntimeHost & { states: Map<string, StoredState> } {
	const states = new Map<string, StoredState>();
	return {
		namespace: "ems.0",
		log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
		getStateAsync: async (id) => (states.has(id) ? (states.get(id) as ioBroker.State) : null),
		setStateAsync: async (id, state) => {
			states.set(id, { val: state.val as ioBroker.StateValue, ack: state.ack ?? true });
		},
		setObjectNotExistsAsync: async () => undefined,
		subscribeStatesAsync: async () => undefined,
		unsubscribeStatesAsync: async () => undefined,
		states,
	};
}

describe("planner_shadow integration", () => {
	it("matched end-to-end shadow run with real worker and compact states", async () => {
		const root = path.join(os.tmpdir(), `ems-shadow-int-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const repository = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repository);
		const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
		const host = memoryHost();

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
			compareShadowOutput: ({ snapshot, prepared }) => compareSnapshotPreparedInput(snapshot, prepared).result,
		};

		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await host.setStateAsync(PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, { val: true, ack: false });
		await host.setStateAsync(PLANNER_COORDINATOR_STATE_IDS.manualTrigger, { val: true, ack: false });

		const { handlePlannerShadowStateChange } = await import("./runtime.js");
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
		await new Promise((r) => setTimeout(r, 100));

		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.equal(status.comparisonStatus, "matched");
		assert.equal(lifecycle.isRunning(), false);
		assert.equal(host.states.get(PLANNER_COORDINATOR_STATE_IDS.comparisonStatus)?.val, "matched");
		assert.ok(!JSON.stringify(Object.fromEntries(host.states)).includes("slots15Min"));

		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("mismatch integration when worker projection differs from in-process reference", async () => {
		const root = path.join(os.tmpdir(), `ems-shadow-mismatch-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => durable,
		});
		const repository = new PlannerRepository(layout);
		const lifecycle = new PlannerJobLifecycle(layout, repository);
		const workerScriptPath = lifecycle.resolveWorkerPath(process.cwd());
		const host = memoryHost();
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());

		const deps: PlannerOnDemandCoordinatorDependencies = {
			now: () => new Date("2026-07-01T12:00:00.000Z"),
			buildSnapshot: async () => snapshot,
			isWorkerRunning: () => lifecycle.isRunning(),
			shutdownWorker: () => lifecycle.shutdown(),
			readWorkerResult: (jobId) => readJobResult(layout.jobDir(jobId)),
			readPreparedOutput: (jobId, expectedInputRevision) =>
				readAndValidatePreparedInputFile(layout.jobDir(jobId), {
					expectedInputRevision,
					runtimeRootDir: layout.runtimePlannerDir,
				}),
			cleanupJob: (jobId) => repository.cleanupJobDir(layout.jobDir(jobId), true),
			runWorkerJob: async ({ jobId, generation, snapshot: snap, triggerReason, requestedAt }) => {
				const jobDir = layout.jobDir(jobId);
				await writePlannerInputSnapshot(jobDir, snap, {
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
					input: snap as unknown as import("../planner_contracts/types.js").PlannerInputSnapshot,
					workerScriptPath,
				});
				return { ...runResult, result: await readJobResult(jobDir) };
			},
			compareShadowOutput: () => ({
				status: "mismatch",
				referenceRevision: "a".repeat(64),
				workerRevision: "b".repeat(64),
				mismatchCount: 1,
				firstMismatchPath: "slots[0].maxImportW",
			}),
		};

		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		const { handlePlannerShadowStateChange } = await import("./runtime.js");
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
		await new Promise((r) => setTimeout(r, 100));

		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.equal(status.comparisonStatus, "mismatch");
		assert.equal(status.comparisonMismatchCount, 1);

		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
		await fs.rm(root, { recursive: true, force: true });
	});
});

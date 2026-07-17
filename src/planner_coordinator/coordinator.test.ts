import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createPlannerOnDemandCoordinatorForTest } from "./compose.js";
import { PlannerOnDemandCoordinator } from "./coordinator.js";
import { mergeTriggerRequests } from "./trigger.js";
import type {
	PlannerOnDemandCoordinatorDependencies,
	PlannerTriggerRequest,
} from "./types.js";
import type { PlannerInputSnapshot } from "../planner_snapshot/types.js";
import type { PlannerPreparedInput } from "../planner_preparation/types.js";
import type { PlannerWorkerResult } from "../planner_contracts/types.js";
import { PlannerInputValidationError } from "../planner_preparation/types.js";
import { assertNoForbiddenImportRoots } from "../test_support/import_graph.js";

function snapshot(rev = "a".repeat(64)): PlannerInputSnapshot {
	return {
		schemaVersion: 2,
		capturedAt: "2026-07-01T12:00:00.000Z",
		timezone: "Europe/Berlin",
		inputRevision: rev,
		sourceRevision: null,
		general: { globalMode: "balanced", executionMode: "dryrun", globalModePolicyLabel: null, snowCoverSuspected: null },
		policy: {
			revision: null,
			status: null,
			gridImportAllowed: true,
			maxGridImportW: 5000,
			houseFuseLimitW: 11000,
			energyPriority: [],
			mutualExclusions: [],
		},
		live: {
			pvPowerW: 1,
			houseLoadW: 1,
			socPct: 50,
			bufferTempC: 40,
			outdoorTempC: 20,
			cloudPct: 10,
			currentPriceCtPerKwh: 30,
			fixedPriceCtPerKwh: null,
		},
		learning: {
			pvBias: {
				correctedTodayKwh: null,
				correctedTomorrowKwh: null,
				rawTodayKwh: null,
				rawTomorrowKwh: null,
				confidencePct: null,
				status: null,
				lastUpdateTs: null,
			},
			pvHorizon: [],
			houseLoad: {
				status: null,
				confidence: null,
				lastUpdate: null,
				forecastToday: null,
				forecastTomorrow: null,
			},
			weather: {
				status: null,
				health: null,
				confidencePct: null,
				lastUpdate: null,
				forecastSource: null,
				actualSource: null,
			},
			thermalRuntime: {
				status: null,
				health: null,
				samples: null,
				runtimeHoursAvg: null,
				runtimeHoursMedian: null,
				coolingRateCPerHAvg: null,
				coolingKPerH: null,
				coolingAsymptoteC: null,
				coolingAsymptoteSource: null,
				currentTemperatureC: null,
				estimatedRemainingHours: null,
				estimatedEmptyAt: null,
				bySeason: null,
				byDayType: null,
				generatedAt: null,
				history: [],
			},
		},
		prices: { slots15Min: [{ slotStartIso: "2026-07-01T12:00:00.000Z", priceCtPerKwh: 30 }] },
		intents: {
			thermal: { mode: "auto", operatingRequestStatus: null },
			battery: {
				operatingRequest: null,
				operatingRequestStatus: null,
				topOffRequested: null,
				hold: false,
				charge: false,
			},
		},
		battery: {
			socPct: 50,
			capacityEffectiveKwh: 10,
			capacityNetKwh: 10,
			capacitySource: null,
			minSocPct: 10,
			maxSocPct: 100,
			maxChargeW: 5000,
			chargeCapable: true,
			dischargeCapable: true,
			fault: false,
			lockout: false,
			telemetryValid: true,
			telemetryStale: false,
			telemetryReady: true,
			ownershipActive: false,
			winterGridActive: false,
		},
		wallbox: {
			connected: false,
			charging: false,
			vehicleSocPct: null,
			planSocPct: null,
			planActive: false,
			sessionEnergyKwh: null,
			deadlineIso: null,
			activePhases: null,
			maxCurrentA: null,
			evccConfigured: false,
			batteryMode: null,
			batteryDischargeControl: null,
		},
		thermal: {
			bufferTempC: 40,
			runtimeState: null,
			faultActive: false,
			config: {
				forecastModeEnabled: true,
				planningMaxTempC: 55,
				stages: [],
				minRuntimeMin: null,
				minPauseMin: null,
			},
		},
		airConditioning: { units: [] },
		governance: { addons: [] },
		consumerStats: [],
		batteryWinter: { config: { enabled: false, horizonDays: 0, socTargetMinPct: null, socTargetMaxPct: null }, days: [] },
	};
}

function prepared(rev: string): PlannerPreparedInput {
	return {
		schemaVersion: 1,
		inputRevision: rev,
		preparationRevision: "b".repeat(64),
		generatedAt: "2026-07-01T12:00:00.000Z",
		timezone: "Europe/Berlin",
		capturedAt: "2026-07-01T12:00:00.000Z",
		horizonStart: "2026-07-01T12:00:00.000Z",
		horizonEnd: "2026-07-01T13:00:00.000Z",
		slots: [{ startIso: "2026-07-01T12:00:00.000Z", endIso: "2026-07-01T12:15:00.000Z", priceCtPerKwh: 30, importAllowed: true, maxImportPowerW: 5000, priceLabel: "normal" }],
		policy: {
			globalMode: "balanced",
			gridImportAllowed: true,
			effectiveMaxGridImportW: 5000,
			configuredMaxGridImportW: 5000,
			configuredHouseFuseLimitW: 11000,
			currentPriceCtPerKwh: 30,
			priceSource: "dynamic_tariff",
		},
		diagnostics: {
			slotCount: 1,
			gridSupplyQuality: "valid",
			gridSupplyReasonDe: "ok",
			houseFuseConstraintStatus: "valid",
			globalConstraintsStatus: "valid",
		},
	};
}

function workerResult(jobId: string, generation: number): PlannerWorkerResult {
	return {
		schemaVersion: 1,
		jobId,
		generation,
		status: "ok",
		semanticRevision: "c".repeat(64),
		summary: {
			forecast: { status: "ready", revision: 1, horizonStart: "x", horizonEnd: "y", reasonDe: "r" },
			daily: { status: "ready", revision: 1, date: "2026-07-01", validUntil: null, reasonDe: "r" },
			quality: { forecast: "prepared", daily: "stub" },
		},
		allocations: [],
		files: [{ fileName: "prepared_input_v1.json", byteSize: 100, sha256: "d".repeat(64) }],
	};
}

function createFakeDeps(overrides: Partial<PlannerOnDemandCoordinatorDependencies> = {}): {
	deps: PlannerOnDemandCoordinatorDependencies;
	calls: {
		builds: number;
		workers: number;
		cleanups: string[];
		workerRunning: boolean;
	};
} {
	const calls = { builds: 0, workers: 0, cleanups: [] as string[], workerRunning: false };
	let currentRev = 0;
	const deps: PlannerOnDemandCoordinatorDependencies = {
		now: () => new Date("2026-07-01T12:00:00.000Z"),
		buildSnapshot: async () => {
			calls.builds += 1;
			currentRev += 1;
			return snapshot("".padStart(64, String(currentRev)));
		},
		isWorkerRunning: () => calls.workerRunning,
		shutdownWorker: async () => {
			calls.workerRunning = false;
		},
		runWorkerJob: async ({ jobId, generation, snapshot: snap }) => {
			calls.workers += 1;
			calls.workerRunning = true;
			calls.workerRunning = false;
			return {
				jobId,
				generation,
				exitCode: 0,
				timedOut: false,
				published: false,
				publishReason: "simulation",
				stdoutBytes: 0,
				stderrBytes: 0,
				result: workerResult(jobId, generation),
			};
		},
		readWorkerResult: async (jobId) => workerResult(jobId, 1),
		readPreparedOutput: async (_jobId, inputRevision) => prepared(inputRevision),
		cleanupJob: async (jobId) => {
			calls.cleanups.push(jobId);
		},
		...overrides,
	};
	return { deps, calls };
}

describe("planner_coordinator trigger merge", () => {
	it("prefers higher priority trigger reason", () => {
		const merged = mergeTriggerRequests(
			{ reason: "relevant_change", requestedAt: "t1" },
			{ reason: "manual", requestedAt: "t2" },
		);
		assert.equal(merged.reason, "manual");
		assert.equal(merged.requestedAt, "t2");
	});

	it("preserves force flag when coalescing", () => {
		const merged = mergeTriggerRequests(
			{ reason: "scheduled", requestedAt: "t1", force: false },
			{ reason: "relevant_change", requestedAt: "t2", force: true },
		);
		assert.equal(merged.force, true);
	});

	it("does not clear force true with later non-forced request", () => {
		const first = mergeTriggerRequests(
			{ reason: "relevant_change", requestedAt: "t1", force: true },
			{ reason: "scheduled", requestedAt: "t2", force: false },
		);
		const merged = mergeTriggerRequests(first, { reason: "test", requestedAt: "t3", force: false });
		assert.equal(merged.force, true);
	});
});

describe("planner_coordinator disabled by default", () => {
	it("construction does not start a job", async () => {
		const { deps, calls } = createFakeDeps();
		createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		assert.equal(calls.builds, 0);
		assert.equal(calls.workers, 0);
	});

	it("disabled request returns planner_disabled", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
		assert.equal(outcome.result, "skipped");
		assert.equal(outcome.skipReason, "planner_disabled");
	});

	it("shutdown of never-started coordinator is safe", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		await coordinator.stop();
		await coordinator.stop();
		assert.equal(coordinator.getStatus().state, "stopped");
	});
});

describe("planner_coordinator successful run", () => {
	it("builds exactly one snapshot and starts one worker", async () => {
		const { deps, calls } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
		assert.equal(outcome.result, "success");
		assert.equal(calls.builds, 1);
		assert.equal(calls.workers, 1);
	});

	it("sets compact success status without large payloads", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.equal(status.lastInputRevision?.length, 64);
		assert.ok(!("slots" in (status as unknown as Record<string, unknown>)));
		assert.equal(coordinator.getRetainedPayloadBytes(), 0);
		assert.equal(coordinator.hasActiveJobReference(), false);
	});
});

describe("planner_coordinator single-flight and coalescing", () => {
	it("coalesces parallel requests into one follow-up run", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let workerCount = 0;
		const { deps, calls } = createFakeDeps({
			runWorkerJob: async ({ jobId, generation }) => {
				workerCount += 1;
				await gate;
				return {
					jobId,
					generation,
					exitCode: 0,
					timedOut: false,
					published: false,
					publishReason: "simulation",
					stdoutBytes: 0,
					stderrBytes: 0,
					result: workerResult(jobId, generation),
				};
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const p1 = coordinator.request({ reason: "relevant_change", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		const p2 = coordinator.request({ reason: "manual", requestedAt: "t2" });
		const p3 = coordinator.request({ reason: "scheduled", requestedAt: "t3" });
		assert.equal((await p2).result, "coalesced");
		assert.equal((await p3).result, "coalesced");
		release();
		await p1;
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(workerCount, 2);
		assert.equal(calls.builds, 2);
	});

	it("does not grow an unbounded pending queue", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const base = createFakeDeps();
		const { deps, calls } = createFakeDeps({
			runWorkerJob: async (args) => {
				await gate;
				calls.workers += 1;
				return base.deps.runWorkerJob(args);
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const first = coordinator.request({ reason: "test", requestedAt: "t0" });
		for (let i = 0; i < 5; i++) {
			await coordinator.request({ reason: "relevant_change", requestedAt: `t${i}` });
		}
		const status = coordinator.getStatus();
		assert.equal(status.rerunPending, true);
		assert.ok(status.pendingReason);
		release();
		await first;
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(calls.workers, 2);
	});
});

describe("planner_coordinator unchanged input", () => {
	it("skips worker when inputRevision unchanged after success", async () => {
		const fixed = snapshot("f".repeat(64));
		const { deps, calls } = createFakeDeps({
			buildSnapshot: async () => fixed,
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		const second = await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
		assert.equal(second.result, "skipped");
		assert.equal(second.skipReason, "unchanged_input");
		assert.equal(calls.workers, 1);
	});

	it("does not skip after failed run", async () => {
		const fixed = snapshot("e".repeat(64));
		let failOnce = true;
		const base = createFakeDeps({ buildSnapshot: async () => fixed });
		const { deps, calls } = createFakeDeps({
			buildSnapshot: base.deps.buildSnapshot,
			runWorkerJob: async (args) => {
				if (failOnce) {
					failOnce = false;
					calls.workers += 1;
					throw new Error("worker_exit_nonzero");
				}
				calls.workers += 1;
				return base.deps.runWorkerJob(args);
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const first = await coordinator.request({ reason: "test", requestedAt: "t1" });
		assert.equal(first.result, "failed");
		const second = await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
		assert.equal(second.result, "success");
		assert.equal(calls.workers, 2);
	});

	it("force starts worker despite unchanged revision", async () => {
		const fixed = snapshot("d".repeat(64));
		const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		await coordinator.request({ reason: "relevant_change", requestedAt: "t2", force: true });
		assert.equal(calls.workers, 2);
	});

	it("manual without force skips unchanged revision", async () => {
		const fixed = snapshot("c".repeat(64));
		const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		const second = await coordinator.request({ reason: "manual", requestedAt: "t2" });
		assert.equal(second.result, "skipped");
		assert.equal(second.skipReason, "unchanged_input");
		assert.equal(calls.workers, 1);
	});

	it("ai_request without force skips unchanged revision", async () => {
		const fixed = snapshot("b".repeat(64));
		const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		const second = await coordinator.request({ reason: "ai_request", requestedAt: "t2" });
		assert.equal(second.result, "skipped");
		assert.equal(calls.workers, 1);
	});

	it("startup_recovery without force skips unchanged revision", async () => {
		const fixed = snapshot("a1".repeat(32));
		const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		const second = await coordinator.request({ reason: "startup_recovery", requestedAt: "t2" });
		assert.equal(second.result, "skipped");
		assert.equal(calls.workers, 1);
	});

	it("scheduled with force true runs despite unchanged revision", async () => {
		const fixed = snapshot("d".repeat(64));
		const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		await coordinator.request({ reason: "scheduled", requestedAt: "t2", force: true });
		assert.equal(calls.workers, 2);
	});
});

describe("planner_coordinator error handling", () => {
	it("maps worker timeout", async () => {
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => ({
				...(await createFakeDeps().deps.runWorkerJob(args)),
				timedOut: true,
				exitCode: null,
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.result, "failed");
		assert.equal(outcome.errorCode, "worker_timeout");
	});

	it("maps missing result", async () => {
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => ({
				jobId: args.jobId,
				generation: args.generation,
				exitCode: 0,
				timedOut: false,
				published: false,
				publishReason: "simulation",
				stdoutBytes: 0,
				stderrBytes: 0,
				result: null,
			}),
			readWorkerResult: async () => null,
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.errorCode, "result_missing");
	});

	it("maps generation mismatch", async () => {
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => ({
				...(await createFakeDeps().deps.runWorkerJob(args)),
				result: workerResult(args.jobId, args.generation + 1),
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.errorCode, "result_generation_mismatch");
	});
});

describe("planner_coordinator shutdown", () => {
	it("stop clears pending rerun", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const base = createFakeDeps();
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => {
				await gate;
				return base.deps.runWorkerJob(args);
			},
			shutdownWorker: async () => {
				release();
				await base.deps.shutdownWorker();
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const active = coordinator.request({ reason: "test", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		await coordinator.request({ reason: "manual", requestedAt: "t2" });
		assert.equal(coordinator.getStatus().rerunPending, true);
		await coordinator.stop();
		await active.catch(() => undefined);
		assert.equal(coordinator.getStatus().state, "stopped");
		assert.equal(coordinator.getStatus().rerunPending, false);
	});

	it("does not return to idle after stopped", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.stop();
		assert.equal(coordinator.getStatus().state, "stopped");
	});
});

describe("planner_coordinator import boundaries", () => {
	it("core coordinator does not import operator ticks or worker runtime", () => {
		assert.doesNotThrow(() =>
			assertNoForbiddenImportRoots(
				[
					"planner_coordinator/coordinator.ts",
					"planner_coordinator/trigger.ts",
					"planner_coordinator/status.ts",
					"planner_coordinator/constants.ts",
				],
				[
					"operator/forecast/tick",
					"operator/daily_plan/tick",
					"operator/contributions/read",
					"planner_worker",
					"planner_candidate/build",
				],
			),
		);
	});

	it("does not reference runtime engine paths in coordinator sources", () => {
		const text = readFileSync(path.join(process.cwd(), "src/planner_coordinator/coordinator.ts"), "utf8");
		for (const forbidden of ["runtime/engine", "adapter-core", "ems_light/tick"]) {
			assert.ok(!text.includes(forbidden), forbidden);
		}
	});
});

describe("planner_coordinator status safety", () => {
	it("returns detached status copies", () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		const a = coordinator.getStatus();
		a.generation = 999;
		assert.notEqual(coordinator.getStatus().generation, 999);
	});
});

describe("planner_coordinator additional error and shutdown coverage", () => {
	it("maps snapshot build failure", async () => {
		const { deps } = createFakeDeps({
			buildSnapshot: async () => {
				throw new Error("snapshot_build_failed");
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.result, "failed");
		assert.equal(outcome.errorCode, "snapshot_build_failed");
		assert.equal(coordinator.hasActiveJobReference(), false);
	});

	it("maps worker exit non-zero", async () => {
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => ({
				jobId: args.jobId,
				generation: args.generation,
				exitCode: 1,
				timedOut: false,
				published: false,
				publishReason: "simulation",
				stdoutBytes: 0,
				stderrBytes: 0,
				result: null,
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.errorCode, "worker_exit_nonzero");
	});

	it("maps prepared input revision mismatch", async () => {
		const { deps } = createFakeDeps({
			readPreparedOutput: async () => prepared("x".repeat(64)),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.errorCode, "result_input_revision_mismatch");
	});

	it("maps missing prepared output", async () => {
		const { deps } = createFakeDeps({
			readPreparedOutput: async () => {
				throw new PlannerInputValidationError("prepared_output_missing", "missing");
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.errorCode, "prepared_output_missing");
	});

	it("stop during snapshot build aborts without follow-up", async () => {
		let releaseBuild!: () => void;
		const buildGate = new Promise<void>((resolve) => {
			releaseBuild = resolve;
		});
		const { deps } = createFakeDeps({
			buildSnapshot: async () => {
				await buildGate;
				return snapshot();
			},
			shutdownWorker: async () => {
				releaseBuild();
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const active = coordinator.request({ reason: "test", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		await coordinator.request({ reason: "manual", requestedAt: "t2" });
		await coordinator.stop();
		await active.catch(() => undefined);
		assert.equal(coordinator.getStatus().state, "stopped");
		assert.equal(coordinator.getStatus().rerunPending, false);
	});

	it("multiple stop calls are idempotent", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.stop();
		await coordinator.stop();
		assert.equal(coordinator.getStatus().state, "stopped");
	});

	it("different snapshot revision starts a new worker", async () => {
		const { deps, calls } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
		assert.equal(calls.workers, 2);
	});

	it("does not use timers or cron in coordinator core sources", () => {
		const files = [
			"coordinator.ts",
			"trigger.ts",
			"status.ts",
			"constants.ts",
			"types.ts",
		];
		for (const file of files) {
			const text = readFileSync(path.join(process.cwd(), "src/planner_coordinator", file), "utf8");
			assert.ok(!text.includes("setInterval"), file);
			assert.ok(!text.includes("setTimeout"), file);
			assert.ok(!text.includes("cron"), file);
		}
	});

	it("chooses highest-priority pending reason after coalescing", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => {
				await gate;
				return {
					jobId: args.jobId,
					generation: args.generation,
					exitCode: 0,
					timedOut: false,
					published: false,
					publishReason: "simulation",
					stdoutBytes: 0,
					stderrBytes: 0,
					result: workerResult(args.jobId, args.generation),
				};
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const active = coordinator.request({ reason: "test", requestedAt: "t0" });
		await new Promise((r) => setTimeout(r, 5));
		await coordinator.request({ reason: "relevant_change", requestedAt: "t1" });
		await coordinator.request({ reason: "manual", requestedAt: "t2" });
		assert.equal(coordinator.getStatus().pendingReason, "manual");
		release();
		await active.catch(() => undefined);
		await coordinator.stop();
	});
});

describe("planner_coordinator status semantics", () => {
	it("planner_disabled sets skipped status without active job", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(outcome.result, "skipped");
		assert.equal(outcome.skipReason, "planner_disabled");
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "skipped");
		assert.equal(status.lastSkipReason, "planner_disabled");
		assert.equal(coordinator.hasActiveJobReference(), false);
	});

	it("unchanged_input keeps last successful input revision in status", async () => {
		const fixed = snapshot("f".repeat(64));
		const { deps } = createFakeDeps({ buildSnapshot: async () => fixed });
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "test", requestedAt: "t1" });
		await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "skipped");
		assert.equal(status.lastSkipReason, "unchanged_input");
		assert.equal(status.lastInputRevision, "f".repeat(64));
		assert.equal(status.state, "idle");
	});

	it("coalesced does not overwrite lastResult of active run", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => {
				await gate;
				return {
					jobId: args.jobId,
					generation: args.generation,
					exitCode: 0,
					timedOut: false,
					published: false,
					publishReason: "simulation",
					stdoutBytes: 0,
					stderrBytes: 0,
					result: workerResult(args.jobId, args.generation),
				};
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		const active = coordinator.request({ reason: "test", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		const coalesced = await coordinator.request({ reason: "manual", requestedAt: "t2" });
		assert.equal(coalesced.result, "coalesced");
		const during = coordinator.getStatus();
		assert.equal(during.lastResult, undefined);
		assert.equal(during.rerunPending, true);
		release();
		await active;
		assert.equal(coordinator.getStatus().lastResult, "success");
	});
});

describe("planner_coordinator shadow comparison", () => {
	it("records matched comparison on successful worker run", async () => {
		const { deps } = createFakeDeps({
			compareShadowOutput: () => ({
				status: "matched",
				referenceRevision: "a".repeat(64),
				workerRevision: "a".repeat(64),
				mismatchCount: 0,
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "manual", requestedAt: "t1" });
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.equal(status.comparisonStatus, "matched");
		assert.equal(status.comparisonMismatchCount, 0);
	});

	it("keeps technical success when comparison mismatches", async () => {
		const { deps } = createFakeDeps({
			compareShadowOutput: () => ({
				status: "mismatch",
				referenceRevision: "a".repeat(64),
				workerRevision: "b".repeat(64),
				mismatchCount: 2,
				firstMismatchPath: "slots[0].maxImportW",
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "manual", requestedAt: "t1" });
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "success");
		assert.equal(status.comparisonStatus, "mismatch");
		assert.equal(status.comparisonMismatchCount, 2);
	});

	it("sets worker_failed comparison on worker error", async () => {
		const { deps } = createFakeDeps({
			runWorkerJob: async ({ jobId, generation }) => ({
				jobId,
				generation,
				exitCode: 1,
				timedOut: false,
				published: false,
				publishReason: "simulation",
				stdoutBytes: 0,
				stderrBytes: 0,
				result: null,
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "manual", requestedAt: "t1" });
		const status = coordinator.getStatus();
		assert.equal(status.lastResult, "failed");
		assert.equal(status.comparisonStatus, "worker_failed");
	});

	it("unchanged_input does not refresh comparison status", async () => {
		const fixed = snapshot("f".repeat(64));
		const { deps } = createFakeDeps({
			buildSnapshot: async () => fixed,
			compareShadowOutput: () => ({
				status: "matched",
				referenceRevision: "a".repeat(64),
				workerRevision: "a".repeat(64),
				mismatchCount: 0,
			}),
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		await coordinator.request({ reason: "manual", requestedAt: "t1" });
		const afterSuccess = coordinator.getStatus().comparisonStatus;
		await coordinator.request({ reason: "manual", requestedAt: "t2" });
		const afterSkip = coordinator.getStatus();
		assert.equal(afterSkip.lastSkipReason, "unchanged_input");
		assert.equal(afterSkip.comparisonStatus, afterSuccess);
	});

	it("subscribeStatus receives updates and unsubscribes cleanly", async () => {
		const { deps } = createFakeDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		const seen: string[] = [];
		const unsubscribe = coordinator.subscribeStatus((status) => {
			seen.push(status.state);
		});
		assert.ok(seen.includes("disabled"));
		coordinator.enable();
		assert.ok(seen.includes("idle"));
		unsubscribe();
		const before = seen.length;
		await coordinator.request({ reason: "test", requestedAt: "t" });
		assert.equal(seen.length, before);
	});

	it("disable during active run interrupts worker and skips pending rerun", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let shutdownCalled = false;
		const { deps } = createFakeDeps({
			runWorkerJob: async (args) => {
				await gate;
				return {
					jobId: args.jobId,
					generation: args.generation,
					exitCode: 0,
					timedOut: false,
					published: false,
					publishReason: "simulation",
					stdoutBytes: 0,
					stderrBytes: 0,
					result: workerResult(args.jobId, args.generation),
				};
			},
			shutdownWorker: async () => {
				shutdownCalled = true;
				release();
			},
		});
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		void coordinator.request({ reason: "manual", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		void coordinator.request({ reason: "manual", requestedAt: "t2" });
		await coordinator.disable({ interruptActive: true });
		assert.equal(shutdownCalled, true);
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(coordinator.getStatus().rerunPending, false);
		assert.equal(coordinator.getStatus().enabled, false);
	});
});

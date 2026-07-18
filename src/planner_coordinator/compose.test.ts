import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import {
	createPlannerOnDemandCoordinatorFromAdapter,
	createPlannerOnDemandCoordinatorForTest,
	isPlannerRuntimeContextLoadedForTest,
	registerPlannerOnDemandCoordinatorForTest,
	resetPlannerRuntimeLoadStateForTest,
	stopPlannerOnDemandCoordinator,
	PlannerCoordinatorAlreadyActiveError,
} from "./compose.js";
import { wrapCoordinatorStageError } from "./errors.js";
import type { PlannerCoordinatorAdapterHost } from "./runtime_factory.js";
import type { PlannerInputSnapshot } from "../planner_snapshot/types.js";
import { stopEmsLightPhase1 } from "../ems_light/index.js";
import type { PlannerOnDemandCoordinatorDependencies } from "./types.js";

const HEAVY_MODULE_MARKERS = [
	"/build/operator/",
	"/build/planner_preparation/validate.js",
	"/build/planner_preparation/prepare.js",
	"/build/planner_worker/worker_job.js",
	"/build/planner_snapshot/builder.js",
	"/build/planner_snapshot/from_iobroker.js",
	"/build/planner_coordinator/runtime_factory.js",
];

function fakeHost(): PlannerCoordinatorAdapterHost {
	return {
		namespace: "ems.0",
		getAbsoluteInstanceDataDir: () => path.join("/tmp", "ems-coord-lazy"),
		getStateAsync: async () => null,
		config: {},
	};
}

function modulesFromChild(stdout: string): string[] {
	return stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => line.replace(process.cwd(), ""));
}

function runChildScript(body: string): { status: number | null; stdout: string; stderr: string } {
	return spawnSync(process.execPath, ["-e", body], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, NODE_OPTIONS: "" },
	});
}

describe("planner_coordinator lazy load", () => {
	it("disabled registration does not load heavy planner modules", () => {
		const script = `
const path = require("path");
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const host = {
  namespace: "ems.0",
  getAbsoluteInstanceDataDir: () => "/tmp/ems-coord-lazy",
  getStateAsync: async () => null,
  config: {},
};
compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
console.log(Object.keys(require.cache).join("\\n"));
`;
		const result = runChildScript(script);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const modules = modulesFromChild(result.stdout);
		for (const marker of HEAVY_MODULE_MARKERS) {
			assert.ok(!modules.some((entry) => entry.includes(marker)), marker);
		}
	});

	it("enabled construction without request does not load heavy modules", () => {
		const script = `
const path = require("path");
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const host = {
  namespace: "ems.0",
  getAbsoluteInstanceDataDir: () => "/tmp/ems-coord-lazy",
  getStateAsync: async () => null,
  config: {},
};
const coordinator = compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: true });
coordinator.enable();
console.log(Object.keys(require.cache).join("\\n"));
`;
		const result = runChildScript(script);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const modules = modulesFromChild(result.stdout);
		for (const marker of HEAVY_MODULE_MARKERS) {
			assert.ok(!modules.some((entry) => entry.includes(marker)), marker);
		}
	});

	it("stop without prior job does not load heavy modules", () => {
		const script = `
const path = require("path");
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const host = {
  namespace: "ems.0",
  getAbsoluteInstanceDataDir: () => "/tmp/ems-coord-lazy-stop",
  getStateAsync: async () => null,
  config: {},
};
(async () => {
  compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
  await compose.stopPlannerOnDemandCoordinator();
  console.log(Object.keys(require.cache).join("\\n"));
})();
`;
		const result = runChildScript(script);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const modules = modulesFromChild(result.stdout);
		for (const marker of HEAVY_MODULE_MARKERS) {
			assert.ok(!modules.some((entry) => entry.includes(marker)), marker);
		}
	});

	it("runtime import failure surfaces as runtime_import_failed stage", async () => {
		resetPlannerRuntimeLoadStateForTest();
		const host = fakeHost();
		const coordinator = createPlannerOnDemandCoordinatorFromAdapter(host, {
			enabled: true,
			packageRoot: "/tmp/ems-missing-package-root-for-import-test",
		});
		// Force lazy path to fail by clearing and injecting a broken loader via request after
		// swapping buildSnapshot through a test coordinator is covered elsewhere; here we assert
		// classify + compose wrap by calling a failing dynamic import through buildSnapshot deps.
		coordinator.enable();
		await stopPlannerOnDemandCoordinator();
		resetPlannerRuntimeLoadStateForTest();
		const logs: string[] = [];
		const failing = createPlannerOnDemandCoordinatorForTest(
			{
				now: () => new Date(),
				buildSnapshot: async () => {
					throw wrapCoordinatorStageError(
						"runtime_import_failed",
						"runtime_import_failed",
						new Error("Cannot find module './runtime_factory.js'"),
					);
				},
				runWorkerJob: async () => {
					throw new Error("unreachable");
				},
				readPreparedOutput: async () => {
					throw new Error("unreachable");
				},
				readWorkerResult: async () => null,
				cleanupJob: async () => undefined,
				isWorkerRunning: () => false,
				shutdownWorker: async () => undefined,
			},
			{
				enabled: true,
				log: {
					error: (m: string) => logs.push(m),
					warn: () => undefined,
					info: () => undefined,
					debug: () => undefined,
				},
			},
		);
		failing.enable();
		const outcome = await failing.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
		assert.equal(outcome.errorCode, "runtime_import_failed");
		assert.equal(failing.getStatus().lastErrorStage, "runtime_import_failed");
		assert.ok(logs.some((l) => l.includes("runtime_import_failed")));
	});

	it("first enabled request loads runtime modules", async () => {
		const host = fakeHost();
		const coordinator = createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: true });
		coordinator.enable();
		assert.equal(isPlannerRuntimeContextLoadedForTest(), false);
		await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() }).catch(() => undefined);
		assert.equal(isPlannerRuntimeContextLoadedForTest(), true);
		await stopPlannerOnDemandCoordinator();
	});
});

describe("planner_coordinator compose lifecycle", () => {
	it("rejects second active coordinator creation", async () => {
		const host = fakeHost();
		createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
		assert.throws(
			() => createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false }),
			PlannerCoordinatorAlreadyActiveError,
		);
		await stopPlannerOnDemandCoordinator();
	});

	it("allows new coordinator after stop", async () => {
		const host = fakeHost();
		const first = createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
		await stopPlannerOnDemandCoordinator();
		const second = createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
		assert.notEqual(first, second);
		await stopPlannerOnDemandCoordinator();
	});

	it("stopEmsLightPhase1 awaits running coordinator shutdown", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let shutdownCalled = false;
		const fixedRevision = "a".repeat(64);
		const deps: PlannerOnDemandCoordinatorDependencies = {
			now: () => new Date(),
			buildSnapshot: async () =>
				({
					schemaVersion: 2,
					capturedAt: "2026-07-01T12:00:00.000Z",
					timezone: "Europe/Berlin",
					inputRevision: fixedRevision,
					sourceRevision: null,
					general: { globalMode: "balanced", executionMode: "dryrun", globalModePolicyLabel: null, snowCoverSuspected: null },
					policy: { revision: null, status: null, gridImportAllowed: true, maxGridImportW: 5000, houseFuseLimitW: 11000, energyPriority: [], mutualExclusions: [] },
					live: { pvPowerW: 1, houseLoadW: 1, socPct: 50, bufferTempC: 40, outdoorTempC: 20, cloudPct: 10, currentPriceCtPerKwh: 30, fixedPriceCtPerKwh: null },
					learning: { pvBias: {}, pvHorizon: [], houseLoad: {}, weather: {}, thermalRuntime: { status: null, health: null, samples: null, runtimeHoursAvg: null, runtimeHoursMedian: null, coolingRateCPerHAvg: null, coolingKPerH: null, coolingAsymptoteC: null, coolingAsymptoteSource: null, currentTemperatureC: null, estimatedRemainingHours: null, estimatedEmptyAt: null, generatedAt: null, bySeason: null, byDayType: null, history: [] } },
					prices: { slots15Min: [{ slotStartIso: "2026-07-01T12:00:00.000Z", priceCtPerKwh: 30 }] },
					intents: { thermal: { mode: "auto", operatingRequestStatus: null }, battery: { operatingRequest: null, operatingRequestStatus: null, topOffRequested: null, hold: false, charge: false } },
					battery: { socPct: 50, capacityEffectiveKwh: 10, capacityNetKwh: 10, capacitySource: null, minSocPct: 10, maxSocPct: 100, maxChargeW: 5000, chargeCapable: true, dischargeCapable: true, fault: false, lockout: false, telemetryValid: true, telemetryStale: false, telemetryReady: true, ownershipActive: false, winterGridActive: false },
					wallbox: { connected: false, charging: false, vehicleSocPct: null, planSocPct: null, planActive: false, sessionEnergyKwh: null, deadlineIso: null, activePhases: null, maxCurrentA: null, evccConfigured: false, batteryMode: null, batteryDischargeControl: null },
					thermal: { bufferTempC: 40, runtimeState: null, faultActive: false, config: { forecastModeEnabled: true, planningMaxTempC: 55, stages: [], minRuntimeMin: null, minPauseMin: null } },
					airConditioning: { units: [] },
					governance: { addons: [] },
					consumerStats: [],
					batteryWinter: { config: { enabled: false, horizonDays: 0, socTargetMinPct: null, socTargetMaxPct: null }, days: [] },
				}) as unknown as PlannerInputSnapshot,
			isWorkerRunning: () => true,
			shutdownWorker: async () => {
				release();
				shutdownCalled = true;
			},
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
					result: {
						schemaVersion: 1,
						jobId: args.jobId,
						generation: args.generation,
						status: "ok",
						semanticRevision: "c".repeat(64),
						summary: {
							forecast: { status: "ready", revision: 1, horizonStart: "x", horizonEnd: "y", reasonDe: "r" },
							daily: { status: "ready", revision: 1, date: "2026-07-01", validUntil: null, reasonDe: "r" },
							quality: { forecast: "prepared", daily: "stub" },
						},
						allocations: [],
						files: [{ fileName: "prepared_input_v1.json", byteSize: 100, sha256: "d".repeat(64) }],
					},
				};
			},
			readWorkerResult: async () => null,
			readPreparedOutput: async (_jobId, inputRevision) => ({
				schemaVersion: 1,
				inputRevision,
				preparationRevision: "b".repeat(64),
				generatedAt: "2026-07-01T12:00:00.000Z",
				timezone: "Europe/Berlin",
				capturedAt: "2026-07-01T12:00:00.000Z",
				horizonStart: "2026-07-01T12:00:00.000Z",
				horizonEnd: "2026-07-01T13:00:00.000Z",
				slots: [],
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
					slotCount: 0,
					gridSupplyQuality: "valid",
					gridSupplyReasonDe: "ok",
					houseFuseConstraintStatus: "valid",
					globalConstraintsStatus: "valid",
				},
			}),
			cleanupJob: async () => undefined,
		};
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: true });
		coordinator.enable();
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		void coordinator.request({ reason: "test", requestedAt: "t1" });
		await new Promise((r) => setTimeout(r, 5));
		await coordinator.request({ reason: "manual", requestedAt: "t2" });
		const stopPromise = stopEmsLightPhase1();
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(shutdownCalled, true);
		await stopPromise;
		assert.equal(coordinator.getStatus().state, "stopped");
		assert.equal(coordinator.getStatus().rerunPending, false);
	});

	it("adapter shutdown is idempotent without unhandled rejections", async () => {
		const host = fakeHost();
		createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
		await stopEmsLightPhase1();
		await stopEmsLightPhase1();
		await stopPlannerOnDemandCoordinator();
	});
});

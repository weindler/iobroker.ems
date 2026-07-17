import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	createPlannerOnDemandCoordinatorForTest,
	isPlannerRuntimeContextLoadedForTest,
	registerPlannerOnDemandCoordinatorForTest,
	stopPlannerOnDemandCoordinator,
} from "../planner_coordinator/compose.js";
import type { PlannerOnDemandCoordinatorDependencies } from "../planner_coordinator/types.js";
import type { PlannerInputSnapshot } from "../planner_snapshot/types.js";
import { PLANNER_COORDINATOR_STATE_IDS } from "./ensure_states.js";
import {
	handlePlannerShadowStateChange,
	initPlannerShadowRuntime,
	isPlannerShadowEnabledForTest,
	stopPlannerShadowRuntime,
} from "./runtime.js";
import type { PlannerShadowRuntimeHost } from "./runtime.js";

type StoredState = { val: ioBroker.StateValue; ack: boolean };

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
			pvBias: {},
			pvHorizon: [],
			houseLoad: {},
			weather: {},
			thermalRuntime: { status: null, health: null, samples: null, runtimeHoursAvg: null, runtimeHoursMedian: null, coolingRateCPerHAvg: null, coolingKPerH: null, coolingAsymptoteC: null, coolingAsymptoteSource: null, currentTemperatureC: null, estimatedRemainingHours: null, estimatedEmptyAt: null, generatedAt: null, bySeason: null, byDayType: null, history: [] },
		},
		prices: { slots15Min: [{ slotStartIso: "2026-07-01T12:00:00.000Z", priceCtPerKwh: 30 }] },
		intents: { thermal: { mode: "auto", operatingRequestStatus: null }, battery: { operatingRequest: null, operatingRequestStatus: null, topOffRequested: null, hold: false, charge: false } },
		battery: { socPct: 50, capacityEffectiveKwh: 10, capacityNetKwh: 10, capacitySource: null, minSocPct: 10, maxSocPct: 100, maxChargeW: 5000, chargeCapable: true, dischargeCapable: true, fault: false, lockout: false, telemetryValid: true, telemetryStale: false, telemetryReady: true, ownershipActive: false, winterGridActive: false },
		wallbox: { connected: false, charging: false, vehicleSocPct: null, planSocPct: null, planActive: false, sessionEnergyKwh: null, deadlineIso: null, activePhases: null, maxCurrentA: null, evccConfigured: false, batteryMode: null, batteryDischargeControl: null },
		thermal: { bufferTempC: 40, runtimeState: null, faultActive: false, config: { forecastModeEnabled: true, planningMaxTempC: 55, stages: [], minRuntimeMin: null, minPauseMin: null } },
		airConditioning: { units: [] },
		governance: { addons: [] },
		consumerStats: [],
		batteryWinter: { config: { enabled: false, horizonDays: 0, socTargetMinPct: null, socTargetMaxPct: null }, days: [] },
	} as unknown as PlannerInputSnapshot;
}

function createMemoryHost(config: Record<string, unknown> = {}): PlannerShadowRuntimeHost & { states: Map<string, StoredState> } {
	const states = new Map<string, StoredState>();
	const subscribed = new Set<string>();
	return {
		namespace: "ems.0",
		config,
		states,
		log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
		getStateAsync: async (id) => (states.has(id) ? (states.get(id) as ioBroker.State) : null),
		setStateAsync: async (id, state) => {
			states.set(id, { val: state.val as ioBroker.StateValue, ack: state.ack ?? true });
		},
		setObjectNotExistsAsync: async () => undefined,
		subscribeStatesAsync: async (pattern) => {
			subscribed.add(pattern);
		},
		unsubscribeStatesAsync: async (pattern) => {
			subscribed.delete(pattern);
		},
	};
}

function createDeps(): PlannerOnDemandCoordinatorDependencies {
	let workerCalls = 0;
	return {
		now: () => new Date("2026-07-01T12:00:00.000Z"),
		buildSnapshot: async () => snapshot(`${++workerCalls}`.padStart(64, "0")),
		isWorkerRunning: () => false,
		shutdownWorker: async () => undefined,
		runWorkerJob: async ({ jobId, generation }) => ({
			jobId,
			generation,
			exitCode: 0,
			timedOut: false,
			published: false,
			publishReason: "simulation",
			stdoutBytes: 0,
			stderrBytes: 0,
			result: {
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
			},
		}),
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
		compareShadowOutput: () => ({
			status: "matched",
			referenceRevision: "a".repeat(64),
			workerRevision: "a".repeat(64),
			mismatchCount: 0,
		}),
	};
}

describe("planner_shadow runtime", () => {
	it("starts with shadow disabled and does not load heavy runtime", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "off" });
		const coordinator = createPlannerOnDemandCoordinatorForTest(createDeps(), { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		assert.equal(isPlannerShadowEnabledForTest(), false);
		assert.equal(coordinator.getStatus().enabled, false);
		assert.equal(isPlannerRuntimeContextLoadedForTest(), false);
		assert.equal(host.states.get(PLANNER_COORDINATOR_STATE_IDS.shadowEnabled)?.val, false);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("native off ignores session shadow_enabled=true", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "off" });
		const coordinator = createPlannerOnDemandCoordinatorForTest(createDeps(), { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
		assert.equal(isPlannerShadowEnabledForTest(), false);
		assert.equal(coordinator.getStatus().enabled, false);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("activation alone does not start a worker", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "shadow_manual" });
		let builds = 0;
		const deps = createDeps();
		deps.buildSnapshot = async () => {
			builds += 1;
			return snapshot();
		};
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		assert.equal(builds, 0);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("disabled manual trigger sets planner_disabled skip", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "off" });
		const coordinator = createPlannerOnDemandCoordinatorForTest(createDeps(), { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
		assert.equal(coordinator.getStatus().lastSkipReason, "planner_disabled");
		assert.equal(coordinator.getStatus().lastResult, "skipped");
		assert.equal(host.states.get(PLANNER_COORDINATOR_STATE_IDS.manualTrigger)?.val, false);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("ignores acked manual trigger", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "shadow_manual" });
		let workers = 0;
		const deps = createDeps();
		deps.runWorkerJob = async (args) => {
			workers += 1;
			return createDeps().runWorkerJob!(args);
		};
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, true);
		assert.equal(workers, 0);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("enabled manual trigger starts exactly one run", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "shadow_manual" });
		let workers = 0;
		const deps = createDeps();
		deps.runWorkerJob = async (args) => {
			workers += 1;
			return createDeps().runWorkerJob!(args);
		};
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
		await new Promise((r) => setTimeout(r, 40));
		assert.equal(workers, 1);
		assert.equal(coordinator.getStatus().lastResult, "success");
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("force trigger passes force true to coordinator", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "shadow_manual" });
		const forces: boolean[] = [];
		const deps = createDeps();
		const coordinator = createPlannerOnDemandCoordinatorForTest(deps, { enabled: false });
		const originalRequest = coordinator.request.bind(coordinator);
		coordinator.request = async (trigger) => {
			forces.push(trigger.force === true);
			return originalRequest(trigger);
		};
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger, true, false);
		await new Promise((r) => setTimeout(r, 40));
		assert.deepEqual(forces, [true]);
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});

	it("writes compact primitive status states only", async () => {
		const host = createMemoryHost({ planner_runtime_mode: "shadow_manual" });
		const coordinator = createPlannerOnDemandCoordinatorForTest(createDeps(), { enabled: false });
		registerPlannerOnDemandCoordinatorForTest(coordinator);
		await initPlannerShadowRuntime(host);
		await handlePlannerShadowStateChange(host, PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
		await new Promise((r) => setTimeout(r, 40));
		const comparisonStatus = host.states.get(PLANNER_COORDINATOR_STATE_IDS.comparisonStatus)?.val;
		assert.equal(comparisonStatus, "matched");
		const refRev = String(host.states.get(PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision)?.val ?? "");
		assert.ok(refRev.length <= 12);
		for (const [, stored] of host.states) {
			assert.ok(
				stored.val === null ||
					typeof stored.val === "string" ||
					typeof stored.val === "number" ||
					typeof stored.val === "boolean",
				`non-primitive state value: ${JSON.stringify(stored.val)}`,
			);
		}
		await stopPlannerShadowRuntime();
		await stopPlannerOnDemandCoordinator();
	});
});

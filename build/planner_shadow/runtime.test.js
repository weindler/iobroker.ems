"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const compose_js_1 = require("../planner_coordinator/compose.js");
const ensure_states_js_1 = require("./ensure_states.js");
const runtime_js_1 = require("./runtime.js");
function snapshot(rev = "a".repeat(64)) {
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
    };
}
function createMemoryHost() {
    const states = new Map();
    const subscribed = new Set();
    return {
        namespace: "ems.0",
        states,
        log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
        getStateAsync: async (id) => (states.has(id) ? states.get(id) : null),
        setStateAsync: async (id, state) => {
            states.set(id, { val: state.val, ack: state.ack ?? true });
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
function createDeps() {
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
(0, node_test_1.describe)("planner_shadow runtime", () => {
    (0, node_test_1.it)("starts with shadow disabled and does not load heavy runtime", async () => {
        const host = createMemoryHost();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(createDeps(), { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        strict_1.default.equal((0, runtime_js_1.isPlannerShadowEnabledForTest)(), false);
        strict_1.default.equal(coordinator.getStatus().enabled, false);
        strict_1.default.equal((0, compose_js_1.isPlannerRuntimeContextLoadedForTest)(), false);
        strict_1.default.equal(host.states.get(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled)?.val, false);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("activation alone does not start a worker", async () => {
        const host = createMemoryHost();
        let builds = 0;
        const deps = createDeps();
        deps.buildSnapshot = async () => {
            builds += 1;
            return snapshot();
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        strict_1.default.equal((0, runtime_js_1.isPlannerShadowEnabledForTest)(), true);
        strict_1.default.equal(coordinator.getStatus().enabled, true);
        strict_1.default.equal(builds, 0);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("disabled manual trigger sets planner_disabled skip", async () => {
        const host = createMemoryHost();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(createDeps(), { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
        strict_1.default.equal(coordinator.getStatus().lastSkipReason, "planner_disabled");
        strict_1.default.equal(coordinator.getStatus().lastResult, "skipped");
        strict_1.default.equal(host.states.get(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger)?.val, false);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("ignores acked manual trigger", async () => {
        const host = createMemoryHost();
        let workers = 0;
        const deps = createDeps();
        deps.runWorkerJob = async (args) => {
            workers += 1;
            return createDeps().runWorkerJob(args);
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, true);
        strict_1.default.equal(workers, 0);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("enabled manual trigger starts exactly one run", async () => {
        const host = createMemoryHost();
        let workers = 0;
        const deps = createDeps();
        deps.runWorkerJob = async (args) => {
            workers += 1;
            return createDeps().runWorkerJob(args);
        };
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
        await new Promise((r) => setTimeout(r, 20));
        strict_1.default.equal(workers, 1);
        strict_1.default.equal(coordinator.getStatus().lastResult, "success");
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("force trigger passes force true to coordinator", async () => {
        const host = createMemoryHost();
        const forces = [];
        const deps = createDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        const originalRequest = coordinator.request.bind(coordinator);
        coordinator.request = async (trigger) => {
            forces.push(trigger.force === true);
            return originalRequest(trigger);
        };
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger, true, false);
        await new Promise((r) => setTimeout(r, 20));
        strict_1.default.deepEqual(forces, [true]);
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("writes compact primitive status states only", async () => {
        const host = createMemoryHost();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(createDeps(), { enabled: false });
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        await (0, runtime_js_1.initPlannerShadowRuntime)(host);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true, false);
        await (0, runtime_js_1.handlePlannerShadowStateChange)(host, ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, true, false);
        await new Promise((r) => setTimeout(r, 30));
        const comparisonStatus = host.states.get(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.comparisonStatus)?.val;
        strict_1.default.equal(comparisonStatus, "matched");
        const refRev = String(host.states.get(ensure_states_js_1.PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision)?.val ?? "");
        strict_1.default.ok(refRev.length <= 12);
        for (const [, stored] of host.states) {
            strict_1.default.ok(typeof stored.val === "string" || typeof stored.val === "number" || typeof stored.val === "boolean");
        }
        await (0, runtime_js_1.stopPlannerShadowRuntime)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
});

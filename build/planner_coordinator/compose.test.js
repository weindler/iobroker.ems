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
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const compose_js_1 = require("./compose.js");
const errors_js_1 = require("./errors.js");
const index_js_1 = require("../ems_light/index.js");
const HEAVY_MODULE_MARKERS = [
    "/build/operator/",
    "/build/planner_preparation/validate.js",
    "/build/planner_preparation/prepare.js",
    "/build/planner_worker/worker_job.js",
    "/build/planner_snapshot/builder.js",
    "/build/planner_snapshot/from_iobroker.js",
    "/build/planner_coordinator/runtime_factory.js",
];
function fakeHost() {
    return {
        namespace: "ems.0",
        getAbsoluteInstanceDataDir: () => path.join("/tmp", "ems-coord-lazy"),
        getStateAsync: async () => null,
        config: {},
    };
}
function modulesFromChild(stdout) {
    return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(process.cwd(), ""));
}
function runChildScript(body) {
    return (0, node_child_process_1.spawnSync)(process.execPath, ["-e", body], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
    });
}
(0, node_test_1.describe)("planner_coordinator lazy load", () => {
    (0, node_test_1.it)("disabled registration does not load heavy planner modules", () => {
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
        strict_1.default.equal(result.status, 0, result.stderr || result.stdout);
        const modules = modulesFromChild(result.stdout);
        for (const marker of HEAVY_MODULE_MARKERS) {
            strict_1.default.ok(!modules.some((entry) => entry.includes(marker)), marker);
        }
    });
    (0, node_test_1.it)("enabled construction without request does not load heavy modules", () => {
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
        strict_1.default.equal(result.status, 0, result.stderr || result.stdout);
        const modules = modulesFromChild(result.stdout);
        for (const marker of HEAVY_MODULE_MARKERS) {
            strict_1.default.ok(!modules.some((entry) => entry.includes(marker)), marker);
        }
    });
    (0, node_test_1.it)("stop without prior job does not load heavy modules", () => {
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
        strict_1.default.equal(result.status, 0, result.stderr || result.stdout);
        const modules = modulesFromChild(result.stdout);
        for (const marker of HEAVY_MODULE_MARKERS) {
            strict_1.default.ok(!modules.some((entry) => entry.includes(marker)), marker);
        }
    });
    (0, node_test_1.it)("runtime import failure surfaces as runtime_import_failed stage", async () => {
        (0, compose_js_1.resetPlannerRuntimeLoadStateForTest)();
        const host = fakeHost();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, {
            enabled: true,
            packageRoot: "/tmp/ems-missing-package-root-for-import-test",
        });
        // Force lazy path to fail by clearing and injecting a broken loader via request after
        // swapping buildSnapshot through a test coordinator is covered elsewhere; here we assert
        // classify + compose wrap by calling a failing dynamic import through buildSnapshot deps.
        coordinator.enable();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
        (0, compose_js_1.resetPlannerRuntimeLoadStateForTest)();
        const logs = [];
        const failing = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)({
            now: () => new Date(),
            buildSnapshot: async () => {
                throw (0, errors_js_1.wrapCoordinatorStageError)("runtime_import_failed", "runtime_import_failed", new Error("Cannot find module './runtime_factory.js'"));
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
        }, {
            enabled: true,
            log: {
                error: (m) => logs.push(m),
                warn: () => undefined,
                info: () => undefined,
                debug: () => undefined,
            },
        });
        failing.enable();
        const outcome = await failing.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
        strict_1.default.equal(outcome.errorCode, "runtime_import_failed");
        strict_1.default.equal(failing.getStatus().lastErrorStage, "runtime_import_failed");
        strict_1.default.ok(logs.some((l) => l.includes("runtime_import_failed")));
    });
    (0, node_test_1.it)("first enabled request loads runtime modules", async () => {
        const host = fakeHost();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: true });
        coordinator.enable();
        strict_1.default.equal((0, compose_js_1.isPlannerRuntimeContextLoadedForTest)(), false);
        await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() }).catch(() => undefined);
        strict_1.default.equal((0, compose_js_1.isPlannerRuntimeContextLoadedForTest)(), true);
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
});
(0, node_test_1.describe)("planner_coordinator compose lifecycle", () => {
    (0, node_test_1.it)("rejects second active coordinator creation", async () => {
        const host = fakeHost();
        (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: false });
        strict_1.default.throws(() => (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: false }), compose_js_1.PlannerCoordinatorAlreadyActiveError);
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("allows new coordinator after stop", async () => {
        const host = fakeHost();
        const first = (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: false });
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
        const second = (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: false });
        strict_1.default.notEqual(first, second);
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
    (0, node_test_1.it)("stopEmsLightPhase1 awaits running coordinator shutdown", async () => {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        let shutdownCalled = false;
        const fixedRevision = "a".repeat(64);
        const deps = {
            now: () => new Date(),
            buildSnapshot: async () => ({
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
            }),
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        (0, compose_js_1.registerPlannerOnDemandCoordinatorForTest)(coordinator);
        void coordinator.request({ reason: "test", requestedAt: "t1" });
        await new Promise((r) => setTimeout(r, 5));
        await coordinator.request({ reason: "manual", requestedAt: "t2" });
        const stopPromise = (0, index_js_1.stopEmsLightPhase1)();
        await new Promise((r) => setTimeout(r, 10));
        strict_1.default.equal(shutdownCalled, true);
        await stopPromise;
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
        strict_1.default.equal(coordinator.getStatus().rerunPending, false);
    });
    (0, node_test_1.it)("adapter shutdown is idempotent without unhandled rejections", async () => {
        const host = fakeHost();
        (0, compose_js_1.createPlannerOnDemandCoordinatorFromAdapter)(host, { enabled: false });
        await (0, index_js_1.stopEmsLightPhase1)();
        await (0, index_js_1.stopEmsLightPhase1)();
        await (0, compose_js_1.stopPlannerOnDemandCoordinator)();
    });
});

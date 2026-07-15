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
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const compose_js_1 = require("./compose.js");
const trigger_js_1 = require("./trigger.js");
const types_js_1 = require("../planner_preparation/types.js");
const import_graph_js_1 = require("../test_support/import_graph.js");
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
function prepared(rev) {
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
function workerResult(jobId, generation) {
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
function createFakeDeps(overrides = {}) {
    const calls = { builds: 0, workers: 0, cleanups: [], workerRunning: false };
    let currentRev = 0;
    const deps = {
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
(0, node_test_1.describe)("planner_coordinator trigger merge", () => {
    (0, node_test_1.it)("prefers higher priority trigger reason", () => {
        const merged = (0, trigger_js_1.mergeTriggerRequests)({ reason: "relevant_change", requestedAt: "t1" }, { reason: "manual", requestedAt: "t2" });
        strict_1.default.equal(merged.reason, "manual");
        strict_1.default.equal(merged.requestedAt, "t2");
    });
    (0, node_test_1.it)("preserves force flag when coalescing", () => {
        const merged = (0, trigger_js_1.mergeTriggerRequests)({ reason: "scheduled", requestedAt: "t1", force: false }, { reason: "relevant_change", requestedAt: "t2", force: true });
        strict_1.default.equal(merged.force, true);
    });
    (0, node_test_1.it)("does not clear force true with later non-forced request", () => {
        const first = (0, trigger_js_1.mergeTriggerRequests)({ reason: "relevant_change", requestedAt: "t1", force: true }, { reason: "scheduled", requestedAt: "t2", force: false });
        const merged = (0, trigger_js_1.mergeTriggerRequests)(first, { reason: "test", requestedAt: "t3", force: false });
        strict_1.default.equal(merged.force, true);
    });
});
(0, node_test_1.describe)("planner_coordinator disabled by default", () => {
    (0, node_test_1.it)("construction does not start a job", async () => {
        const { deps, calls } = createFakeDeps();
        (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        strict_1.default.equal(calls.builds, 0);
        strict_1.default.equal(calls.workers, 0);
    });
    (0, node_test_1.it)("disabled request returns planner_disabled", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
        strict_1.default.equal(outcome.result, "skipped");
        strict_1.default.equal(outcome.skipReason, "planner_disabled");
    });
    (0, node_test_1.it)("shutdown of never-started coordinator is safe", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        await coordinator.stop();
        await coordinator.stop();
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
    });
});
(0, node_test_1.describe)("planner_coordinator successful run", () => {
    (0, node_test_1.it)("builds exactly one snapshot and starts one worker", async () => {
        const { deps, calls } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
        strict_1.default.equal(outcome.result, "success");
        strict_1.default.equal(calls.builds, 1);
        strict_1.default.equal(calls.workers, 1);
    });
    (0, node_test_1.it)("sets compact success status without large payloads", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: new Date().toISOString() });
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "success");
        strict_1.default.equal(status.lastInputRevision?.length, 64);
        strict_1.default.ok(!("slots" in status));
        strict_1.default.equal(coordinator.getRetainedPayloadBytes(), 0);
        strict_1.default.equal(coordinator.hasActiveJobReference(), false);
    });
});
(0, node_test_1.describe)("planner_coordinator single-flight and coalescing", () => {
    (0, node_test_1.it)("coalesces parallel requests into one follow-up run", async () => {
        let release;
        const gate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const p1 = coordinator.request({ reason: "relevant_change", requestedAt: "t1" });
        await new Promise((r) => setTimeout(r, 5));
        const p2 = coordinator.request({ reason: "manual", requestedAt: "t2" });
        const p3 = coordinator.request({ reason: "scheduled", requestedAt: "t3" });
        strict_1.default.equal((await p2).result, "coalesced");
        strict_1.default.equal((await p3).result, "coalesced");
        release();
        await p1;
        await new Promise((r) => setTimeout(r, 10));
        strict_1.default.equal(workerCount, 2);
        strict_1.default.equal(calls.builds, 2);
    });
    (0, node_test_1.it)("does not grow an unbounded pending queue", async () => {
        let release;
        const gate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const first = coordinator.request({ reason: "test", requestedAt: "t0" });
        for (let i = 0; i < 5; i++) {
            await coordinator.request({ reason: "relevant_change", requestedAt: `t${i}` });
        }
        const status = coordinator.getStatus();
        strict_1.default.equal(status.rerunPending, true);
        strict_1.default.ok(status.pendingReason);
        release();
        await first;
        await new Promise((r) => setTimeout(r, 20));
        strict_1.default.equal(calls.workers, 2);
    });
});
(0, node_test_1.describe)("planner_coordinator unchanged input", () => {
    (0, node_test_1.it)("skips worker when inputRevision unchanged after success", async () => {
        const fixed = snapshot("f".repeat(64));
        const { deps, calls } = createFakeDeps({
            buildSnapshot: async () => fixed,
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        const second = await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
        strict_1.default.equal(second.result, "skipped");
        strict_1.default.equal(second.skipReason, "unchanged_input");
        strict_1.default.equal(calls.workers, 1);
    });
    (0, node_test_1.it)("does not skip after failed run", async () => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const first = await coordinator.request({ reason: "test", requestedAt: "t1" });
        strict_1.default.equal(first.result, "failed");
        const second = await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
        strict_1.default.equal(second.result, "success");
        strict_1.default.equal(calls.workers, 2);
    });
    (0, node_test_1.it)("force starts worker despite unchanged revision", async () => {
        const fixed = snapshot("d".repeat(64));
        const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        await coordinator.request({ reason: "relevant_change", requestedAt: "t2", force: true });
        strict_1.default.equal(calls.workers, 2);
    });
    (0, node_test_1.it)("manual without force skips unchanged revision", async () => {
        const fixed = snapshot("c".repeat(64));
        const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        const second = await coordinator.request({ reason: "manual", requestedAt: "t2" });
        strict_1.default.equal(second.result, "skipped");
        strict_1.default.equal(second.skipReason, "unchanged_input");
        strict_1.default.equal(calls.workers, 1);
    });
    (0, node_test_1.it)("ai_request without force skips unchanged revision", async () => {
        const fixed = snapshot("b".repeat(64));
        const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        const second = await coordinator.request({ reason: "ai_request", requestedAt: "t2" });
        strict_1.default.equal(second.result, "skipped");
        strict_1.default.equal(calls.workers, 1);
    });
    (0, node_test_1.it)("startup_recovery without force skips unchanged revision", async () => {
        const fixed = snapshot("a1".repeat(32));
        const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        const second = await coordinator.request({ reason: "startup_recovery", requestedAt: "t2" });
        strict_1.default.equal(second.result, "skipped");
        strict_1.default.equal(calls.workers, 1);
    });
    (0, node_test_1.it)("scheduled with force true runs despite unchanged revision", async () => {
        const fixed = snapshot("d".repeat(64));
        const { deps, calls } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        await coordinator.request({ reason: "scheduled", requestedAt: "t2", force: true });
        strict_1.default.equal(calls.workers, 2);
    });
});
(0, node_test_1.describe)("planner_coordinator error handling", () => {
    (0, node_test_1.it)("maps worker timeout", async () => {
        const { deps } = createFakeDeps({
            runWorkerJob: async (args) => ({
                ...(await createFakeDeps().deps.runWorkerJob(args)),
                timedOut: true,
                exitCode: null,
            }),
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.result, "failed");
        strict_1.default.equal(outcome.errorCode, "worker_timeout");
    });
    (0, node_test_1.it)("maps missing result", async () => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.errorCode, "result_missing");
    });
    (0, node_test_1.it)("maps generation mismatch", async () => {
        const { deps } = createFakeDeps({
            runWorkerJob: async (args) => ({
                ...(await createFakeDeps().deps.runWorkerJob(args)),
                result: workerResult(args.jobId, args.generation + 1),
            }),
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.errorCode, "result_generation_mismatch");
    });
});
(0, node_test_1.describe)("planner_coordinator shutdown", () => {
    (0, node_test_1.it)("stop clears pending rerun", async () => {
        let release;
        const gate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const active = coordinator.request({ reason: "test", requestedAt: "t1" });
        await new Promise((r) => setTimeout(r, 5));
        await coordinator.request({ reason: "manual", requestedAt: "t2" });
        strict_1.default.equal(coordinator.getStatus().rerunPending, true);
        await coordinator.stop();
        await active.catch(() => undefined);
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
        strict_1.default.equal(coordinator.getStatus().rerunPending, false);
    });
    (0, node_test_1.it)("does not return to idle after stopped", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.stop();
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
    });
});
(0, node_test_1.describe)("planner_coordinator import boundaries", () => {
    (0, node_test_1.it)("does not import operator runtime modules", () => {
        strict_1.default.doesNotThrow(() => (0, import_graph_js_1.assertNoForbiddenImportRoots)([
            "planner_coordinator/coordinator.ts",
            "planner_coordinator/trigger.ts",
            "planner_coordinator/status.ts",
            "planner_coordinator/constants.ts",
            "planner_coordinator/types.ts",
        ], ["operator"]));
    });
    (0, node_test_1.it)("does not reference runtime engine paths in coordinator sources", () => {
        const text = (0, node_fs_1.readFileSync)(path.join(process.cwd(), "src/planner_coordinator/coordinator.ts"), "utf8");
        for (const forbidden of ["runtime/engine", "adapter-core", "ems_light/tick"]) {
            strict_1.default.ok(!text.includes(forbidden), forbidden);
        }
    });
});
(0, node_test_1.describe)("planner_coordinator status safety", () => {
    (0, node_test_1.it)("returns detached status copies", () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        const a = coordinator.getStatus();
        a.generation = 999;
        strict_1.default.notEqual(coordinator.getStatus().generation, 999);
    });
});
(0, node_test_1.describe)("planner_coordinator additional error and shutdown coverage", () => {
    (0, node_test_1.it)("maps snapshot build failure", async () => {
        const { deps } = createFakeDeps({
            buildSnapshot: async () => {
                throw new Error("snapshot_build_failed");
            },
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.result, "failed");
        strict_1.default.equal(outcome.errorCode, "snapshot_build_failed");
        strict_1.default.equal(coordinator.hasActiveJobReference(), false);
    });
    (0, node_test_1.it)("maps worker exit non-zero", async () => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.errorCode, "worker_exit_nonzero");
    });
    (0, node_test_1.it)("maps prepared input revision mismatch", async () => {
        const { deps } = createFakeDeps({
            readPreparedOutput: async () => prepared("x".repeat(64)),
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.errorCode, "result_input_revision_mismatch");
    });
    (0, node_test_1.it)("maps missing prepared output", async () => {
        const { deps } = createFakeDeps({
            readPreparedOutput: async () => {
                throw new types_js_1.PlannerInputValidationError("prepared_output_missing", "missing");
            },
        });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.errorCode, "prepared_output_missing");
    });
    (0, node_test_1.it)("stop during snapshot build aborts without follow-up", async () => {
        let releaseBuild;
        const buildGate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const active = coordinator.request({ reason: "test", requestedAt: "t1" });
        await new Promise((r) => setTimeout(r, 5));
        await coordinator.request({ reason: "manual", requestedAt: "t2" });
        await coordinator.stop();
        await active.catch(() => undefined);
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
        strict_1.default.equal(coordinator.getStatus().rerunPending, false);
    });
    (0, node_test_1.it)("multiple stop calls are idempotent", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.stop();
        await coordinator.stop();
        strict_1.default.equal(coordinator.getStatus().state, "stopped");
    });
    (0, node_test_1.it)("different snapshot revision starts a new worker", async () => {
        const { deps, calls } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
        strict_1.default.equal(calls.workers, 2);
    });
    (0, node_test_1.it)("does not use timers or cron in coordinator core sources", () => {
        const files = [
            "coordinator.ts",
            "trigger.ts",
            "status.ts",
            "constants.ts",
            "types.ts",
        ];
        for (const file of files) {
            const text = (0, node_fs_1.readFileSync)(path.join(process.cwd(), "src/planner_coordinator", file), "utf8");
            strict_1.default.ok(!text.includes("setInterval"), file);
            strict_1.default.ok(!text.includes("setTimeout"), file);
            strict_1.default.ok(!text.includes("cron"), file);
        }
    });
    (0, node_test_1.it)("chooses highest-priority pending reason after coalescing", async () => {
        let release;
        const gate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const active = coordinator.request({ reason: "test", requestedAt: "t0" });
        await new Promise((r) => setTimeout(r, 5));
        await coordinator.request({ reason: "relevant_change", requestedAt: "t1" });
        await coordinator.request({ reason: "manual", requestedAt: "t2" });
        strict_1.default.equal(coordinator.getStatus().pendingReason, "manual");
        release();
        await active.catch(() => undefined);
        await coordinator.stop();
    });
});
(0, node_test_1.describe)("planner_coordinator status semantics", () => {
    (0, node_test_1.it)("planner_disabled sets skipped status without active job", async () => {
        const { deps } = createFakeDeps();
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: false });
        const outcome = await coordinator.request({ reason: "test", requestedAt: "t" });
        strict_1.default.equal(outcome.result, "skipped");
        strict_1.default.equal(outcome.skipReason, "planner_disabled");
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "skipped");
        strict_1.default.equal(status.lastSkipReason, "planner_disabled");
        strict_1.default.equal(coordinator.hasActiveJobReference(), false);
    });
    (0, node_test_1.it)("unchanged_input keeps last successful input revision in status", async () => {
        const fixed = snapshot("f".repeat(64));
        const { deps } = createFakeDeps({ buildSnapshot: async () => fixed });
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        await coordinator.request({ reason: "test", requestedAt: "t1" });
        await coordinator.request({ reason: "relevant_change", requestedAt: "t2" });
        const status = coordinator.getStatus();
        strict_1.default.equal(status.lastResult, "skipped");
        strict_1.default.equal(status.lastSkipReason, "unchanged_input");
        strict_1.default.equal(status.lastInputRevision, "f".repeat(64));
        strict_1.default.equal(status.state, "idle");
    });
    (0, node_test_1.it)("coalesced does not overwrite lastResult of active run", async () => {
        let release;
        const gate = new Promise((resolve) => {
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
        const coordinator = (0, compose_js_1.createPlannerOnDemandCoordinatorForTest)(deps, { enabled: true });
        coordinator.enable();
        const active = coordinator.request({ reason: "test", requestedAt: "t1" });
        await new Promise((r) => setTimeout(r, 5));
        const coalesced = await coordinator.request({ reason: "manual", requestedAt: "t2" });
        strict_1.default.equal(coalesced.result, "coalesced");
        const during = coordinator.getStatus();
        strict_1.default.equal(during.lastResult, undefined);
        strict_1.default.equal(during.rerunPending, true);
        release();
        await active;
        strict_1.default.equal(coordinator.getStatus().lastResult, "success");
    });
});

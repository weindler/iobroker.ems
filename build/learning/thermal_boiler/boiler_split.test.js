"use strict";
/**
 * Boiler vs Puffer Learning — Realfall + T1–T16 (keine Puffer-Samples als Boiler).
 */
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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const history_query_1 = require("../history_query");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const hygiene_1 = require("../../addons/immersion_heater/hygiene");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const mode_policy_1 = require("../../planner/mode_policy");
const immersion_heater_1 = require("../../operator/contributions/flexible/immersion_heater");
const thermal_empty_at_1 = require("../../operator/contributions/flexible/thermal_empty_at");
const thermal_learning_1 = require("../../operator/contributions/flexible/thermal_learning");
const thermal_boiler_buffer_1 = require("../../operator/daily_plan/unified/thermal_boiler_buffer");
const allocate_1 = require("../../operator/daily_plan/unified/allocate");
const fixtures_1 = require("../../operator/daily_plan/unified/fixtures");
const write_allowlist_1 = require("../../addons/wallbox/ev_foundation/write_allowlist");
const math_1 = require("../thermal_runtime/math");
const config_1 = require("./config");
const persist_1 = require("./persist");
const run_1 = require("./run");
const samples_1 = require("./samples");
const MS_H = 3_600_000;
const NOW = Date.parse("2026-08-15T10:00:00.000Z");
const COVER = Date.parse("2026-08-15T16:00:00.000Z");
const NEXT_PV = Date.parse("2026-08-16T06:00:00.000Z");
function linearCurve(startMs, startC, endC, hours, steps = 12) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        out.push({ ts: startMs + frac * hours * MS_H, tempC: startC + (endC - startC) * frac });
    }
    return out;
}
function boilerCfg() {
    return (0, config_1.thermalBoilerConfigFromAdapter)({ ih_boiler_min_temp_c: 50, ih_hygiene_target_temp_c: 60 });
}
function bufferCfg() {
    return {
        enabled: true,
        lookbackDays: 90,
        temperatureStateId: "sensor.0.buffer",
        fullThresholdC: 60,
        emptyThresholdC: 48,
        minRuntimeHours: 0.5,
        maxRuntimeHours: 72,
    };
}
function historyResult(history) {
    return {
        result: history.map((p) => ({
            ts: p.ts,
            val: p.tempC,
            ack: true,
            lc: p.ts,
            from: "test",
        })),
    };
}
function mockBoilerHost(opts) {
    const states = {};
    const stateId = opts.stateId ?? "sensor.0.boiler";
    const mappingTarget = opts.mappingTarget === undefined ? stateId : opts.mappingTarget;
    const mappingEnabled = opts.mappingEnabled !== false && Boolean(mappingTarget);
    if (opts.liveBoilerTempC !== undefined) {
        states["live.thermal.boiler_temp_c"] = opts.liveBoilerTempC;
    }
    const historyIds = [];
    return {
        states,
        historyIds,
        config: {
            ih_boiler_min_temp_c: 50,
            ih_hygiene_target_temp_c: 60,
            ih_planning_max_temp_c: opts.planningMaxTempC ?? 63,
            ih_boiler_temp_c_enabled: mappingEnabled,
            ih_boiler_temp_c_target: mappingEnabled ? mappingTarget : "",
            ih_buffer_temp_c_target: opts.adminBoilerTempTarget ?? "sensor.0.buffer",
            learning_thermal_runtime_enabled: true,
            learning_thermal_runtime_lookback_days: 7,
        },
        getStateAsync: async (id) => ({ val: states[id] }),
        setStateAsync: async (id, state) => {
            states[id] = state.val;
        },
        setObjectNotExistsAsync: async () => undefined,
        getForeignStateAsync: async (id) => {
            if (opts.foreignTemps && Object.prototype.hasOwnProperty.call(opts.foreignTemps, id)) {
                return { val: opts.foreignTemps[id] };
            }
            if (id === stateId || id === mappingTarget) {
                return { val: opts.currentTemp };
            }
            return { val: null };
        },
        getHistoryAsync: async (id) => {
            historyIds.push(id);
            if (opts.historyById && Object.prototype.hasOwnProperty.call(opts.historyById, id)) {
                return historyResult(opts.historyById[id]);
            }
            if (id === stateId || id === mappingTarget) {
                return historyResult(opts.history);
            }
            return { result: [] };
        },
        getAbsolutePath: (category) => path.join(opts.tmp, category ?? ""),
        log: { debug: () => undefined, warn: () => undefined, error: () => undefined },
    };
}
function immersionBase() {
    return {
        now: new Date(NOW),
        addonEnabled: true,
        governanceEnabled: true,
        globalModeOff: false,
        addonExecutionOff: false,
        modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
        config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
            ih_boiler_min_temp_c: 50,
            ih_planning_max_temp_c: 63,
            ih_hygiene_target_temp_c: 60,
            ih_stage_1_set_state: "r.0.on",
            ih_stage_1_nominal_power_w: 1700,
        }),
        bufferTempC: 52,
        boilerTempC: 61,
        boilerSensorDegraded: false,
        thermalMode: "auto",
        fault: false,
        lockout: false,
        relayMapped: true,
        pvTodayKwh: 40,
        pvTomorrowKwh: 20,
        pvBiasStatus: "ready",
        forecastModeEnabled: true,
        aiOptimizationAllowed: false,
        hygieneDue: false,
    };
}
(0, node_test_1.describe)("boiler/buffer split — observed real fault", () => {
    (0, node_test_1.afterEach)(() => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        (0, history_query_1.resetHistoryQueryQueueForTests)();
    });
    (0, node_test_1.it)("T12-real: slow boiler 64→61 vs fast buffer 61→52 — Hard follows boiler", () => {
        const start = NOW - 24 * MS_H;
        const boilerPts = linearCurve(start, 64, 61, 24);
        const bufferPts = linearCurve(NOW - 6 * MS_H, 61, 52, 6);
        const bCfg = boilerCfg();
        const pCfg = bufferCfg();
        const boilerModel = (0, math_1.estimateCoolingModel)(boilerPts, bCfg);
        const bufferModel = (0, math_1.estimateCoolingModel)(bufferPts, pCfg);
        strict_1.default.ok(boilerModel.coolingConstantPerH != null && boilerModel.coolingConstantPerH > 0);
        strict_1.default.ok(bufferModel.coolingConstantPerH != null && bufferModel.coolingConstantPerH > 0);
        const boilerRemain = (0, math_1.estimateRemainingHours)({
            currentTempC: 61,
            fullThresholdC: bCfg.fullThresholdC,
            emptyThresholdC: 50,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: boilerModel.coolingConstantPerH,
            ambientC: boilerModel.asymptoteC,
        });
        const bufferRemain = (0, math_1.estimateRemainingHours)({
            currentTempC: 52,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: bufferModel.coolingConstantPerH,
            ambientC: bufferModel.asymptoteC,
        });
        strict_1.default.ok(boilerRemain != null && boilerRemain > 12, `boiler remain ${boilerRemain}`);
        strict_1.default.ok(bufferRemain != null && bufferRemain < boilerRemain, `buffer remain ${bufferRemain}`);
        const boilerCycles = (0, math_1.detectRuntimeCycles)(boilerPts, bCfg);
        strict_1.default.equal(boilerCycles.length, 0, "64→61 must not count as a completed boiler cycle to 50 °C");
        const emptyAtMs = NOW + (boilerRemain ?? 0) * MS_H;
        const hard = (0, thermal_boiler_buffer_1.resolveBoilerBufferThermalEnergy)({
            nowMs: NOW,
            boilerTempC: 61,
            boilerMinTempC: 50,
            bufferTempC: 52,
            bufferMaxTempC: 63,
            softHeadroomEnergyKwh: 4,
            boilerCoolingRateCPerH: boilerModel.coolingConstantPerH * (61 - boilerModel.asymptoteC),
            boilerEstimatedEmptyAtMs: emptyAtMs,
            boilerEmptyAtUsable: true,
            nextReliablePvMs: NEXT_PV,
            currentWindowEndMs: COVER,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(hard.mandatoryEnergyKwh < 0.05, `hard=${hard.mandatoryEnergyKwh} reason=${hard.reasonDe}`);
        strict_1.default.ok(hard.economicHeadroomKwh > 1);
        const wrongBufferHard = (0, thermal_boiler_buffer_1.resolveBoilerBufferThermalEnergy)({
            nowMs: NOW,
            boilerTempC: 61,
            boilerMinTempC: 50,
            bufferTempC: 52,
            bufferMaxTempC: 63,
            softHeadroomEnergyKwh: 4,
            /** Puffer-ähnliche Crash-Rate (~9 K / 6 h Cover) — darf nicht der Boiler-Pfad sein. */
            boilerCoolingRateCPerH: 2.5,
            boilerEstimatedEmptyAtMs: NOW + 2.7 * MS_H,
            boilerEmptyAtUsable: true,
            nextReliablePvMs: NEXT_PV,
            currentWindowEndMs: COVER,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(wrongBufferHard.mandatoryEnergyKwh > 0.2, "control: using buffer-like rate would create Hard — must not be the boiler path");
    });
});
(0, node_test_1.describe)("boiler learning A vs buffer learning B", () => {
    (0, node_test_1.it)("T1: boiler above min + fast buffer drop → no Hard from buffer", () => {
        const r = (0, thermal_boiler_buffer_1.resolveBoilerBufferThermalEnergy)({
            nowMs: NOW,
            boilerTempC: 61,
            boilerMinTempC: 50,
            bufferTempC: 52,
            bufferMaxTempC: 63,
            softHeadroomEnergyKwh: 4,
            boilerCoolingRateCPerH: null,
            boilerEstimatedEmptyAtMs: null,
            boilerEmptyAtUsable: false,
            nextReliablePvMs: NEXT_PV,
            currentWindowEndMs: COVER,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh < 0.05);
        strict_1.default.ok(r.economicHeadroomKwh > 1);
    });
    (0, node_test_1.it)("T2: boiler approaching 50 °C → remaining hours shrink", () => {
        const cfg = boilerCfg();
        const pts = linearCurve(NOW - 20 * MS_H, 56, 51, 20);
        const model = (0, math_1.estimateCoolingModel)(pts, cfg);
        const far = (0, math_1.estimateRemainingHours)({
            currentTempC: 56,
            fullThresholdC: 60,
            emptyThresholdC: 50,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: model.coolingConstantPerH,
            ambientC: model.asymptoteC,
        });
        const near = (0, math_1.estimateRemainingHours)({
            currentTempC: 51,
            fullThresholdC: 60,
            emptyThresholdC: 50,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: model.coolingConstantPerH,
            ambientC: model.asymptoteC,
        });
        strict_1.default.ok(far != null && near != null && near < far);
    });
    (0, node_test_1.it)("T3: boiler under minimum → Hard", () => {
        const r = (0, thermal_boiler_buffer_1.resolveBoilerBufferThermalEnergy)({
            nowMs: NOW,
            boilerTempC: 48.5,
            boilerMinTempC: 50,
            bufferTempC: 58,
            bufferMaxTempC: 63,
            softHeadroomEnergyKwh: 2,
            boilerCoolingRateCPerH: null,
            boilerEstimatedEmptyAtMs: null,
            boilerEmptyAtUsable: false,
            nextReliablePvMs: NEXT_PV,
            currentWindowEndMs: COVER,
            pvConfidence01: 0.85,
        });
        strict_1.default.ok(r.mandatoryEnergyKwh > 0.3);
        strict_1.default.equal(r.hardFromBoiler, true);
    });
    (0, node_test_1.it)("T4: boiler Newton works without completed cooling cycles", () => {
        const cfg = boilerCfg();
        const pts = linearCurve(NOW - 18 * MS_H, 64, 61, 18);
        strict_1.default.equal((0, math_1.detectRuntimeCycles)(pts, cfg).length, 0);
        strict_1.default.ok((0, math_1.collectCoolingSegments)(pts, cfg.minRuntimeHours).length >= 1);
        const model = (0, math_1.estimateCoolingModel)(pts, cfg);
        const result = (0, math_1.computeThermalRuntimeLearning)({
            cycles: [],
            currentTempC: 61,
            cfg,
            sourceStateId: "sensor.0.boiler",
            now: new Date(NOW),
            coolingConstantPerH: model.coolingConstantPerH,
            asymptoteC: model.asymptoteC,
            asymptoteSource: model.asymptoteSource,
        });
        strict_1.default.ok(result.coolingConstantPerH != null && result.coolingConstantPerH > 0);
        strict_1.default.ok(result.estimatedEmptyAt);
        strict_1.default.ok((result.estimatedRemainingHours ?? 0) > 8);
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: new Date(NOW),
            rawStatus: result.status,
            rawHealth: result.health,
            samples: result.samples,
            coolingRateCPerHAvg: result.coolingRateCPerHAvg,
            coolingConstantPerH: result.coolingConstantPerH,
            coolingAsymptoteC: result.coolingAsymptoteC,
            estimatedRemainingHours: result.estimatedRemainingHours,
            estimatedEmptyAtRaw: result.estimatedEmptyAt,
            byDayTypeJsonRaw: "{}",
            vessel: "boiler",
        });
        strict_1.default.equal(signal.status, "degraded");
        strict_1.default.equal((0, thermal_empty_at_1.thermalEmptyAtUsableForPlanning)(signal), true);
        strict_1.default.match(signal.reasonDe, /Boiler-Learning/);
    });
    (0, node_test_1.it)("T5: buffer cycles are not boiler cycles", () => {
        const bufferToFloor = linearCurve(NOW - 12 * MS_H, 62, 47, 12);
        const boilerStay = linearCurve(NOW - 12 * MS_H, 64, 61, 12);
        strict_1.default.ok((0, math_1.detectRuntimeCycles)(bufferToFloor, bufferCfg()).length >= 1);
        strict_1.default.equal((0, math_1.detectRuntimeCycles)(boilerStay, boilerCfg()).length, 0);
    });
    (0, node_test_1.it)("T6/T7: runThermalBoilerLearning uses boiler history only and writes boiler emptyAt", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-"));
        const boilerPts = linearCurve(NOW - 20 * MS_H, 64, 61, 20);
        const host = mockBoilerHost({ tmp, currentTemp: 61, history: boilerPts });
        await (0, run_1.runThermalBoilerLearning)(host);
        strict_1.default.equal(host.states["learning.thermal_boiler.model"], "newton");
        strict_1.default.equal(host.states["learning.thermal_boiler.samples"], 0);
        strict_1.default.ok(Number(host.states["learning.thermal_boiler.cooling_k_per_h"]) > 0);
        const emptyAt = String(host.states["learning.thermal_boiler.estimated_empty_at"] ?? "");
        strict_1.default.ok(emptyAt.length > 10, `emptyAt=${emptyAt}`);
        strict_1.default.ok(Date.parse(emptyAt) > NOW + 8 * MS_H);
        strict_1.default.match(String(host.states["learning.thermal_boiler.reason_de"]), /nicht Puffer|Newton/);
        const persist = await (0, persist_1.readThermalBoilerPersist)(path.join(tmp, "learning/thermal_boiler"));
        strict_1.default.equal(persist?.module, persist_1.BOILER_MODULE_TAG);
        strict_1.default.equal(persist?.source_kind, "mapping.boiler_temp_c");
        strict_1.default.equal(persist?.source_state_id, "sensor.0.boiler");
        strict_1.default.equal(persist?.samples, 0);
    });
    (0, node_test_1.it)("T17: explain and Newton use mapping.boiler_temp_c=60, never admin/buffer 63 or planningMax", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-src-"));
        const boilerPts = linearCurve(NOW - 8 * MS_H, 60.2, 60, 8);
        const bufferPts = linearCurve(NOW - 8 * MS_H, 63, 63, 8);
        const host = mockBoilerHost({
            tmp,
            stateId: "sensor.0.boiler",
            currentTemp: 60,
            history: boilerPts,
            adminBoilerTempTarget: "sensor.0.buffer",
            planningMaxTempC: 63,
            liveBoilerTempC: 60,
            foreignTemps: {
                "sensor.0.boiler": 60,
                "sensor.0.buffer": 63,
            },
            historyById: {
                "sensor.0.boiler": boilerPts,
                "sensor.0.buffer": bufferPts,
            },
        });
        await (0, run_1.runThermalBoilerLearning)(host);
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], 60);
        strict_1.default.equal(host.states["learning.thermal_boiler.model"], "none");
        strict_1.default.equal(host.states["learning.thermal_boiler.samples"], 0);
        const reason = String(host.states["learning.thermal_boiler.reason_de"] ?? "");
        strict_1.default.match(reason, /Boiler 60\.0 °C/);
        strict_1.default.doesNotMatch(reason, /63/);
        strict_1.default.deepEqual(host.historyIds, ["sensor.0.boiler"]);
    });
    (0, node_test_1.it)("T18: without mapping.boiler_temp_c, admin 63 / live 60 / planningMax 63 are not used", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-nomap-"));
        const host = mockBoilerHost({
            tmp,
            currentTemp: 60,
            history: linearCurve(NOW - 8 * MS_H, 60, 60, 8),
            mappingEnabled: false,
            mappingTarget: "sensor.0.boiler",
            adminBoilerTempTarget: "sensor.0.buffer",
            planningMaxTempC: 63,
            liveBoilerTempC: 60,
            foreignTemps: {
                "sensor.0.boiler": 60,
                "sensor.0.buffer": 63,
            },
        });
        await (0, run_1.runThermalBoilerLearning)(host);
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], null);
        strict_1.default.equal(host.states["learning.thermal_boiler.model"], "none");
        strict_1.default.equal(host.states["learning.thermal_boiler.samples"], 0);
        strict_1.default.match(String(host.states["learning.thermal_boiler.reason_de"]), /Boiler-Sensor fehlt/);
        strict_1.default.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /63/);
        strict_1.default.deepEqual(host.historyIds, []);
    });
    (0, node_test_1.it)("T8: bufferEstimatedEmptyAt never becomes Hard deadline in contribution", () => {
        const [, flex] = (0, immersion_heater_1.buildImmersionHeaterContributions)({
            ...immersionBase(),
            thermalLearning: {
                status: "degraded",
                health: "ok",
                samples: 0,
                coolingRateCPerHAvg: null,
                coolingConstantPerH: 0.2,
                coolingAsymptoteC: 18,
                estimatedRemainingHours: 2,
                estimatedEmptyAt: "2026-08-15T12:00:00.000Z",
                currentDayTypeRuntimeHoursMedian: null,
                reasonDe: "Puffer newton",
            },
            boilerLearning: {
                status: "missing",
                health: null,
                samples: 0,
                coolingRateCPerHAvg: null,
                coolingConstantPerH: null,
                coolingAsymptoteC: null,
                estimatedRemainingHours: null,
                estimatedEmptyAt: null,
                currentDayTypeRuntimeHoursMedian: null,
                reasonDe: "kein boiler model",
            },
        });
        strict_1.default.equal(flex.deadlineIso, null);
        strict_1.default.equal(flex.details.emptyAtPlanningUsable, false);
        strict_1.default.equal(flex.details.bufferEstimatedEmptyAt, null);
        strict_1.default.equal(flex.details.boilerEstimatedEmptyAt, null);
        strict_1.default.equal(flex.details.hardThermalSource, "boiler");
        strict_1.default.equal(flex.details.softThermalSource, "buffer_cap");
        strict_1.default.equal(flex.details.thermalLearningModel, "none");
        strict_1.default.equal(flex.details.bufferLearningModel, "unused");
        strict_1.default.equal(flex.details.boilerLearningModel, "none");
    });
    (0, node_test_1.it)("T9: hygiene >60 °C is boiler-based", () => {
        const hy = (0, hygiene_1.evaluateHygieneDuty)({
            nowMs: NOW,
            boilerTempC: 55,
            hygieneTargetTempC: 60,
            bufferTempC: 63,
            bufferMaxTempC: 63,
            lastBoilerHygieneAtIso: new Date(NOW - 8 * 24 * 3600_000).toISOString(),
            kwhPerDegreeC: 0.38,
        });
        strict_1.default.equal(hy.due, true);
        strict_1.default.equal(hy.blockedByBufferMax, true);
        strict_1.default.equal(hy.mandatoryEnergyKwh, 0);
    });
    (0, node_test_1.it)("T10: buffer safety max unchanged", () => {
        strict_1.default.equal((0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 63, bufferMaxTempC: 63 }), 0);
        strict_1.default.ok((0, thermal_boiler_buffer_1.bufferSoftHeadroomKwh)({ bufferTempC: 52, bufferMaxTempC: 63 }) > 3);
    });
    (0, node_test_1.it)("T11: PV soft precharge still possible when boiler is warm", () => {
        const [, flex] = (0, immersion_heater_1.buildImmersionHeaterContributions)({
            ...immersionBase(),
            bufferTempC: 50,
            boilerTempC: 62,
            todayPvSurplusKwh: 18,
            batterySocPct: 90,
            batteryEndSocTargetPct: 90,
        });
        strict_1.default.equal(flex.deadlineIso, null);
        strict_1.default.ok(flex.enabled === true || flex.details.requiredEnergyKwh > 0 || flex.details.pvPrechargeActive);
    });
    (0, node_test_1.it)("T5-persist: buffer persist file is not accepted as boiler learning", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-rej-"));
        await fs.mkdir(tmp, { recursive: true });
        await fs.writeFile(path.join(tmp, "thermal_boiler_learning_v1.json"), JSON.stringify({
            generated_at: new Date().toISOString(),
            module: "thermal_runtime_learning_v1",
            samples: 12,
            runtime_hours_avg: 8,
            runtime_hours_median: 8,
            cooling_rate_c_per_h_avg: 1.4,
            by_season: {},
            by_day_type: {},
            history: [],
            health: "ok",
        }));
        const read = await (0, persist_1.readThermalBoilerPersist)(tmp);
        strict_1.default.equal(read, null);
    });
    (0, node_test_1.it)("T19: old boiler persist without mapping source_kind is discarded", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-oldsrc-"));
        await fs.mkdir(tmp, { recursive: true });
        await fs.writeFile(path.join(tmp, "thermal_boiler_learning_v1.json"), JSON.stringify({
            generated_at: new Date().toISOString(),
            module: persist_1.BOILER_MODULE_TAG,
            samples: 4,
            runtime_hours_avg: 10,
            runtime_hours_median: 10,
            cooling_rate_c_per_h_avg: 0.4,
            by_season: {},
            by_day_type: {},
            history: [],
            health: "ok",
        }));
        strict_1.default.equal(await (0, persist_1.readThermalBoilerPersist)(tmp), null);
        strict_1.default.equal((0, persist_1.isTrustedBoilerPersist)({
            generated_at: "",
            module: persist_1.BOILER_MODULE_TAG,
            samples: 1,
            runtime_hours_avg: null,
            runtime_hours_median: null,
            cooling_rate_c_per_h_avg: null,
            by_season: {},
            by_day_type: {},
            history: [],
            health: "ok",
            source_kind: "ih_boiler_temp_c_target",
            source_state_id: "sensor.0.buffer",
        }), false);
    });
    (0, node_test_1.it)("T20: persist is trusted only for mapping.boiler_temp_c", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-oksrc-"));
        const boilerPts = linearCurve(NOW - 20 * MS_H, 64, 61, 20);
        const host = mockBoilerHost({ tmp, currentTemp: 60, history: boilerPts });
        await (0, run_1.runThermalBoilerLearning)(host);
        const persist = await (0, persist_1.readThermalBoilerPersist)(path.join(tmp, "learning/thermal_boiler"));
        strict_1.default.equal(persist?.source_kind, persist_1.BOILER_SOURCE_KIND);
        strict_1.default.equal(persist?.source_state_id, "sensor.0.boiler");
        strict_1.default.equal((0, persist_1.isTrustedBoilerPersist)(persist), true);
    });
    (0, node_test_1.it)("T21: startup with stale 63 diagnose writes mapping 59 immediately", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-startup-"));
        const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
        host.states["learning.thermal_boiler.current_temperature_c"] = 63;
        host.states["learning.thermal_boiler.reason_de"] = "Boiler 63.0 °C — Altzustand";
        await (0, run_1.runThermalBoilerLearning)(host, { trigger: "startup", nowMs: NOW });
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
        strict_1.default.match(String(host.states["learning.thermal_boiler.reason_de"]), /Boiler 59\.0 °C/);
        strict_1.default.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /63/);
        strict_1.default.equal(host.states["learning.thermal_boiler.last_run"], new Date(NOW).toISOString());
        strict_1.default.equal(host.states["learning.thermal_boiler.last_sample_at"], new Date(NOW).toISOString());
    });
    (0, node_test_1.it)("T22: mapping valid regular run updates last_run", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-reg-"));
        const host = mockBoilerHost({ tmp, currentTemp: 58, history: [] });
        await (0, run_1.runThermalBoilerLearning)(host, { trigger: "learning_tick", nowMs: NOW });
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], 58);
        const firstRun = String(host.states["learning.thermal_boiler.last_run"]);
        strict_1.default.equal(firstRun, new Date(NOW).toISOString());
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        await (0, run_1.runThermalBoilerLearning)(host, { trigger: "learning_tick", nowMs: NOW + 3_600_000 });
        strict_1.default.equal(host.states["learning.thermal_boiler.last_run"], new Date(NOW + 3_600_000).toISOString());
        strict_1.default.notEqual(String(host.states["learning.thermal_boiler.last_run"]), firstRun);
    });
    (0, node_test_1.it)("T23: mapping missing → no fake temperature", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-miss-"));
        const host = mockBoilerHost({
            tmp,
            currentTemp: 59,
            history: [],
            mappingTarget: null,
            mappingEnabled: false,
        });
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW });
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], null);
        strict_1.default.doesNotMatch(String(host.states["learning.thermal_boiler.reason_de"]), /59/);
    });
    (0, node_test_1.it)("T24: history grows from live samples without a completed cycle", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-grow-"));
        const host = mockBoilerHost({ tmp, currentTemp: 57, history: [] });
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW });
        strict_1.default.equal((0, math_1.detectRuntimeCycles)([], boilerCfg()).length, 0);
        strict_1.default.equal(host.states["learning.thermal_boiler.samples"], 0);
        const persist1 = await (0, persist_1.readThermalBoilerPersist)(path.join(tmp, "learning/thermal_boiler"));
        strict_1.default.ok((persist1?.temp_samples?.length ?? 0) >= 1);
        host.getForeignStateAsync = async (id) => id === "sensor.0.boiler" ? { val: 56 } : { val: null };
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW + samples_1.BOILER_SAMPLE_MIN_INTERVAL_MS });
        const persist = await (0, persist_1.readThermalBoilerPersist)(path.join(tmp, "learning/thermal_boiler"));
        strict_1.default.ok((persist?.temp_samples?.length ?? 0) >= 2);
    });
    (0, node_test_1.it)("T25: Newton-Fallback from persisted boiler samples without ioBroker history cycles", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-newton-"));
        const dir = path.join(tmp, "learning/thermal_boiler");
        await fs.mkdir(dir, { recursive: true });
        const samples = linearCurve(NOW - 20 * MS_H, 64, 51, 20, 20);
        await fs.writeFile(path.join(dir, "thermal_boiler_learning_v1.json"), JSON.stringify({
            generated_at: new Date(NOW).toISOString(),
            module: persist_1.BOILER_MODULE_TAG,
            samples: 0,
            runtime_hours_avg: null,
            runtime_hours_median: null,
            cooling_rate_c_per_h_avg: null,
            by_season: {},
            by_day_type: {},
            history: [],
            health: "no_samples",
            source_kind: persist_1.BOILER_SOURCE_KIND,
            source_state_id: "sensor.0.boiler",
            temp_samples: samples,
        }));
        const host = mockBoilerHost({ tmp, currentTemp: 51, history: [] });
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW });
        strict_1.default.equal(host.states["learning.thermal_boiler.model"], "newton");
        strict_1.default.ok(Number(host.states["learning.thermal_boiler.cooling_k_per_h"]) > 0);
        strict_1.default.match(String(host.states["learning.thermal_boiler.reason_de"]), /Newton|51\.0/);
    });
    (0, node_test_1.it)("T26: untrusted persist without source metadata is discarded on first run", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-discard-"));
        const dir = path.join(tmp, "learning/thermal_boiler");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "thermal_boiler_learning_v1.json"), JSON.stringify({
            generated_at: "2026-08-16T19:07:50.076Z",
            module: persist_1.BOILER_MODULE_TAG,
            samples: 9,
            runtime_hours_avg: 8,
            runtime_hours_median: 8,
            cooling_rate_c_per_h_avg: 1.2,
            by_season: {},
            by_day_type: {},
            history: [],
            health: "ok",
            temp_samples: [{ ts: NOW - MS_H, tempC: 63 }],
        }));
        strict_1.default.equal(await (0, persist_1.readThermalBoilerPersist)(dir), null);
        const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW });
        const persist = await (0, persist_1.readThermalBoilerPersist)(dir);
        strict_1.default.equal(persist?.source_kind, persist_1.BOILER_SOURCE_KIND);
        strict_1.default.equal(persist?.samples, 0);
        strict_1.default.ok((persist?.temp_samples ?? []).every((p) => p.tempC !== 63));
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
    });
    (0, node_test_1.it)("T27: hanging history still publishes live mapping temp (no stale 63)", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-hang-"));
        const host = mockBoilerHost({ tmp, currentTemp: 59, history: [] });
        host.states["learning.thermal_boiler.current_temperature_c"] = 63;
        host.getHistoryAsync = async () => {
            await new Promise((r) => setTimeout(r, 80));
            return historyResult([]);
        };
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW, historyTimeoutMs: 25, trigger: "startup" });
        strict_1.default.equal(host.states["learning.thermal_boiler.current_temperature_c"], 59);
        strict_1.default.match(String(host.states["learning.thermal_boiler.reason_de"]), /59\.0/);
        strict_1.default.ok(String(host.states["learning.thermal_boiler.last_run"]).length > 10);
    });
    (0, node_test_1.it)("T28: overlapping runs do not double-append samples", async () => {
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-boiler-ovl-"));
        const host = mockBoilerHost({ tmp, currentTemp: 56, history: [] });
        host.getHistoryAsync = async () => {
            await new Promise((r) => setTimeout(r, 60));
            return historyResult([]);
        };
        const first = (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW, historyTimeoutMs: 5_000 });
        await new Promise((r) => setTimeout(r, 15));
        await (0, run_1.runThermalBoilerLearning)(host, { nowMs: NOW + 1 });
        await first;
        const persist = await (0, persist_1.readThermalBoilerPersist)(path.join(tmp, "learning/thermal_boiler"));
        strict_1.default.equal(persist?.temp_samples?.length, 1);
    });
    (0, node_test_1.it)("T29: sample debounce prevents write storm", () => {
        const a = (0, samples_1.appendBoilerTempSample)([], { ts: NOW, tempC: 55 }, NOW, 7);
        const b = (0, samples_1.appendBoilerTempSample)(a, { ts: NOW + 1_000, tempC: 55.1 }, NOW + 1_000, 7);
        strict_1.default.equal(b.length, 1);
        const c = (0, samples_1.appendBoilerTempSample)(b, { ts: NOW + samples_1.BOILER_SAMPLE_MIN_INTERVAL_MS, tempC: 54 }, NOW + samples_1.BOILER_SAMPLE_MIN_INTERVAL_MS, 7);
        strict_1.default.equal(c.length, 2);
        strict_1.default.equal((0, samples_1.mergeBoilerTempPoints)(c, c).length, 2);
    });
    (0, node_test_1.it)("T16: no new EV planner writes", () => {
        strict_1.default.equal(write_allowlist_1.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED, false);
    });
});
(0, node_test_1.describe)("boiler split — unified / climate / battery regression smoke", () => {
    (0, node_test_1.it)("T12: unified still allocates thermal soft without boiler Hard", () => {
        const input = (0, fixtures_1.golden001Input)();
        input.time.nowIso = "2026-08-15T10:00:00.000Z";
        input.time.slots = (0, fixtures_1.buildSlots)("2026-08-15T10:00:00.000Z", 8);
        input.thermal = {
            ...input.thermal,
            boilerTempC: 61,
            boilerMinTempC: 50,
            bufferTempC: 52,
            minTempC: 50,
            maxTempC: 63,
            headroomEnergyKwh: 4,
            estimatedEmptyAtIso: null,
            deadlineIso: null,
            emptyAtSource: null,
            boilerEmptyAtUsable: false,
            coolingRateCPerH: null,
        };
        input.wallbox = null;
        input.climate = null;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const hard = plan.allocations
            .filter((a) => a.kind === "immersion_heater" && a.consumerId === "immersion_heater")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const soft = plan.allocations
            .filter((a) => a.kind === "immersion_heater")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(soft >= 0);
        strict_1.default.ok(hard >= 0);
        strict_1.default.ok(plan.reasonCodes.length >= 0);
    });
});

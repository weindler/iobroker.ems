"use strict";
/**
 * Learning-Feedback aus Day Evaluation — speist bestehende Module, keine zweite Engine.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.learningConfidenceTier = exports.applyLearningFeedbackFromEvaluation = exports.noteHouseLoadFeedback = exports.applyThermalHeatFactorFeedback = exports.applyPvBiasFeedbackFromEvaluation = exports.usableHeatFactorKwhPerDegree = exports.writeHeatFactorStore = exports.loadHeatFactorStore = exports.applyThermalHeatFactorSample = exports.clampKwhPerDegree = exports.emptyHeatFactorStore = exports.THERMAL_HEAT_FACTOR_FILE = exports.THERMAL_KWH_MIN_SAMPLES_FOR_USE = exports.THERMAL_KWH_EMA_ALPHA = exports.THERMAL_KWH_PER_C_DEFAULT = exports.THERMAL_KWH_PER_C_MAX = exports.THERMAL_KWH_PER_C_MIN = void 0;
const daily_persist_1 = require("../pv_bias/daily_persist");
const atomic_write_1 = require("../../persistence/atomic_write");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
/** Bounds für geglättete IH kWh/°C (um Default 0.38). */
exports.THERMAL_KWH_PER_C_MIN = 0.2;
exports.THERMAL_KWH_PER_C_MAX = 0.6;
exports.THERMAL_KWH_PER_C_DEFAULT = 0.38;
exports.THERMAL_KWH_EMA_ALPHA = 0.15;
/** Unter dieser Sample-Zahl darf der Faktor Flex-Demand nicht beeinflussen. */
exports.THERMAL_KWH_MIN_SAMPLES_FOR_USE = 5;
exports.THERMAL_HEAT_FACTOR_FILE = "immersion_heat_factor_v1.json";
function emptyHeatFactorStore() {
    return {
        module: "immersion_heat_factor",
        schemaVersion: 1,
        updatedAtIso: new Date(0).toISOString(),
        kwhPerDegreeC: exports.THERMAL_KWH_PER_C_DEFAULT,
        samples: 0,
        lastObservedKwhPerDegreeC: null,
    };
}
exports.emptyHeatFactorStore = emptyHeatFactorStore;
function clampKwhPerDegree(v) {
    return Math.min(exports.THERMAL_KWH_PER_C_MAX, Math.max(exports.THERMAL_KWH_PER_C_MIN, v));
}
exports.clampKwhPerDegree = clampKwhPerDegree;
function applyThermalHeatFactorSample(store, observedKwhPerDegreeC, atIso) {
    if (!Number.isFinite(observedKwhPerDegreeC) || observedKwhPerDegreeC <= 0)
        return store;
    const obs = clampKwhPerDegree(observedKwhPerDegreeC);
    const prev = store.samples <= 0 ? exports.THERMAL_KWH_PER_C_DEFAULT : store.kwhPerDegreeC;
    const next = clampKwhPerDegree(prev * (1 - exports.THERMAL_KWH_EMA_ALPHA) + obs * exports.THERMAL_KWH_EMA_ALPHA);
    return {
        ...store,
        updatedAtIso: atIso,
        kwhPerDegreeC: next,
        samples: store.samples + 1,
        lastObservedKwhPerDegreeC: obs,
    };
}
exports.applyThermalHeatFactorSample = applyThermalHeatFactorSample;
async function loadHeatFactorStore(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, exports.THERMAL_HEAT_FACTOR_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.module === "immersion_heat_factor" && parsed.schemaVersion === 1)
            return parsed;
    }
    catch {
        /* empty */
    }
    return emptyHeatFactorStore();
}
exports.loadHeatFactorStore = loadHeatFactorStore;
async function writeHeatFactorStore(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, exports.THERMAL_HEAT_FACTOR_FILE), `${JSON.stringify(store, null, 2)}\n`);
}
exports.writeHeatFactorStore = writeHeatFactorStore;
/** Nutzbarer Faktor nur bei genug Samples — sonst null (Default behalten). */
function usableHeatFactorKwhPerDegree(store) {
    if (store.samples < exports.THERMAL_KWH_MIN_SAMPLES_FOR_USE)
        return null;
    return store.kwhPerDegreeC;
}
exports.usableHeatFactorKwhPerDegree = usableHeatFactorKwhPerDegree;
/**
 * PV: speist bestehende pv_bias_daily Persistenz (eine Zeile pro Tag — keine Replan-Doppelzählung).
 * Forecast = initial expected (vor Replans), Actual = Evaluation.
 */
async function applyPvBiasFeedbackFromEvaluation(pvBiasDir, ev) {
    const forecast = ev.pv.initialExpectedKwh;
    const actual = ev.pv.actualKwh;
    if (forecast === null && actual === null)
        return false;
    const persist = await (0, daily_persist_1.readDailyPersist)(pvBiasDir);
    const existing = persist.days[ev.plan.date];
    if (existing?.actualKwh != null && existing?.forecastKwh != null) {
        // Bereits vollständiger Tag — kein Überschreiben durch Re-Close
        return false;
    }
    const next = (0, daily_persist_1.upsertDailyRecord)(persist, {
        date: ev.plan.date,
        actualKwh: actual,
        actualCapturedAt: actual !== null ? ev.evaluatedAtIso : existing?.actualCapturedAt ?? null,
        forecastKwh: forecast,
        forecastCapturedAt: forecast !== null ? ev.evaluatedAtIso : existing?.forecastCapturedAt ?? null,
        actualSource: "day_evaluation",
        forecastSource: "day_evaluation_initial_plan",
    });
    await (0, daily_persist_1.writeDailyPersist)(pvBiasDir, next);
    return true;
}
exports.applyPvBiasFeedbackFromEvaluation = applyPvBiasFeedbackFromEvaluation;
/**
 * Thermal: nur wenn geplante ΔT und Ist-Energie belastbar — EMA innerhalb Bounds.
 */
async function applyThermalHeatFactorFeedback(thermalDir, ev) {
    const plannedKwh = ev.immersion.plannedKwh;
    const actualKwh = ev.immersion.actualKwh;
    const target = ev.immersion.plannedTargetTempC;
    if (plannedKwh === null ||
        actualKwh === null ||
        target === null ||
        actualKwh < 0.2 ||
        !ev.immersion.targetReached) {
        return false;
    }
    // Ohne Start-Temp schätzen wir ΔT aus Energie/Default — zu schwach → skip
    // Nutze Ist-Energie / geplante Energie * Default als Observation nur wenn Ziel erreicht
    const observed = (actualKwh / Math.max(plannedKwh, 0.2)) * exports.THERMAL_KWH_PER_C_DEFAULT;
    if (!Number.isFinite(observed) || observed < exports.THERMAL_KWH_PER_C_MIN * 0.5)
        return false;
    const store = await loadHeatFactorStore(thermalDir);
    const next = applyThermalHeatFactorSample(store, observed, ev.evaluatedAtIso);
    await writeHeatFactorStore(thermalDir, next);
    return true;
}
exports.applyThermalHeatFactorFeedback = applyThermalHeatFactorFeedback;
/**
 * House Load: Evaluation speichert Abweichung; keine Tick-Samples.
 * Hier nur Qualitäts-Flag — bestehendes house_load-Modul bleibt History-Authority.
 */
function noteHouseLoadFeedback(ev) {
    return ev.houseLoad.expectedKwh !== null || ev.houseLoad.actualKwh !== null;
}
exports.noteHouseLoadFeedback = noteHouseLoadFeedback;
async function applyLearningFeedbackFromEvaluation(dirs) {
    const ev = dirs.evaluation;
    if (ev.learningApplied) {
        return {
            pvBiasUpserted: false,
            thermalUpdated: false,
            houseLoadNoted: false,
            skippedReason: "already_applied",
        };
    }
    const pvBiasUpserted = await applyPvBiasFeedbackFromEvaluation(dirs.pvBiasDir, ev);
    const thermalUpdated = await applyThermalHeatFactorFeedback(dirs.thermalDir, ev);
    const houseLoadNoted = noteHouseLoadFeedback(ev);
    return {
        pvBiasUpserted,
        thermalUpdated,
        houseLoadNoted,
        skippedReason: null,
    };
}
exports.applyLearningFeedbackFromEvaluation = applyLearningFeedbackFromEvaluation;
/** Confidence-Hinweis: ein Tag allein → few_data. */
function learningConfidenceTier(sampleDays) {
    if (sampleDays <= 0)
        return "none";
    if (sampleDays < 3)
        return "few";
    if (sampleDays < 7)
        return "usable";
    return "usable";
}
exports.learningConfidenceTier = learningConfidenceTier;

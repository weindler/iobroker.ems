"use strict";
/**
 * BLOCK A — Datenmodelle für Findings, Scores, Evaluation-Record und diagnostisches
 * Learning. Rein additiv, liest ausschließlich day_telemetry (+ bestehendes Learning
 * als Referenz), schreibt nie zurück in day_telemetry oder aktive Learning-Module.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA = exports.DAILY_EVALUATOR_SCHEMA_VERSION = exports.emptyDailyEvaluatorLearningState = exports.emptyLearningMetric = exports.SCORE_TOPIC = exports.EVALUATOR_DOMAIN = void 0;
const constants_1 = require("./constants");
Object.defineProperty(exports, "DAILY_EVALUATOR_SCHEMA_VERSION", { enumerable: true, get: function () { return constants_1.DAILY_EVALUATOR_SCHEMA_VERSION; } });
Object.defineProperty(exports, "DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA", { enumerable: true, get: function () { return constants_1.DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA; } });
/** Domänen, für die Findings/Eligibility gebildet werden (Konsumenten-Ebene, nicht 1:1 TELEMETRY_DOMAIN). */
exports.EVALUATOR_DOMAIN = {
    BATTERY: "battery",
    THERMAL: "thermal",
    CLIMATE: "climate",
    EV: "ev",
};
/** Zusätzliche Score-Topics ohne eigene Findings-Domäne (rein deskriptiv aus Telemetrie). */
exports.SCORE_TOPIC = {
    BATTERY: "battery",
    THERMAL: "thermal",
    CLIMATE: "climate",
    EV: "ev",
    PV: "pv",
    PRICE: "price",
    COMFORT: "comfort",
};
function emptyLearningMetric() {
    return {
        value: null,
        sampleCount: 0,
        confidence: null,
        updatedAtIso: null,
        periodStartIso: null,
        periodEndIso: null,
        min: null,
        max: null,
        variance: null,
        reasonDe: "Noch keine Samples.",
    };
}
exports.emptyLearningMetric = emptyLearningMetric;
function emptyDailyEvaluatorLearningState() {
    return {
        module: constants_1.DAILY_EVALUATOR_MODULE,
        schemaVersion: constants_1.DAILY_EVALUATOR_SCHEMA_VERSION,
        updatedAtIso: new Date().toISOString(),
        batteryReserveAccuracyPct: emptyLearningMetric(),
        thermalPriceTimingScore: emptyLearningMetric(),
        climatePriceTimingScore: emptyLearningMetric(),
        evReadinessMetRatePct: emptyLearningMetric(),
        pvUtilizationPct: emptyLearningMetric(),
        priceEfficiencyScore: emptyLearningMetric(),
        lastProcessedDateKey: null,
    };
}
exports.emptyDailyEvaluatorLearningState = emptyDailyEvaluatorLearningState;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const test_helpers_js_1 = require("./test_helpers.js");
const learning_js_1 = require("./learning.js");
const types_js_1 = require("./types.js");
function baseRecord(overrides = {}) {
    return {
        evaluatorSchemaVersion: 1,
        sourceTelemetrySchemaVersion: 1,
        sourceUpdatedAtIso: "2026-06-15T23:00:00.000Z",
        dateKey: "2026-06-15",
        timezone: "Europe/Berlin",
        evaluatedAtIso: "2026-06-16T03:00:00.000Z",
        dayComplete: true,
        dayEvaluable: true,
        dayCoveragePct: 100,
        eligibility: [],
        findingsCount: 0,
        findingsByDomain: { battery: 0, thermal: 0, climate: 0, ev: 0 },
        scores: [],
        globalScore: null,
        globalScoreWeights: {},
        ...overrides,
    };
}
(0, node_test_1.describe)("daily_evaluator learning (diagnostisch, eigener State)", () => {
    (0, node_test_1.it)("battery reserve_held Finding aktualisiert nur batteryReserveAccuracyPct", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(next.batteryReserveAccuracyPct.value, 100);
        strict_1.default.equal(next.batteryReserveAccuracyPct.sampleCount, 1);
        strict_1.default.equal(next.thermalPriceTimingScore.sampleCount, 0);
        strict_1.default.equal(next.climatePriceTimingScore.sampleCount, 0);
        strict_1.default.equal(next.evReadinessMetRatePct.sampleCount, 0);
    });
    (0, node_test_1.it)("insufficientData/notApplicable Findings fließen NICHT ins Learning ein", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"], insufficientData: true }),
            (0, test_helpers_js_1.makeFinding)({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_met"], notApplicable: true }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(next.batteryReserveAccuracyPct.sampleCount, 0);
        strict_1.default.equal(next.evReadinessMetRatePct.sampleCount, 0);
    });
    (0, node_test_1.it)("thermal daily_plan_price_timed Finding aktualisiert thermalPriceTimingScore aus outcomeQuality", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({
                domain: "thermal",
                reasonCodes: ["daily_plan_price_timed"],
                quality: { decisionQuality: "reasonable", outcomeQuality: "wasteful" },
            }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(next.thermalPriceTimingScore.value, 0);
        strict_1.default.equal(next.thermalPriceTimingScore.sampleCount, 1);
    });
    (0, node_test_1.it)("climate price_timed Finding aktualisiert climatePriceTimingScore aus outcomeQuality", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({
                domain: "climate",
                reasonCodes: ["price_timed"],
                quality: { decisionQuality: "reasonable", outcomeQuality: "reasonable" },
            }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(next.climatePriceTimingScore.value, 100);
        strict_1.default.equal(next.climatePriceTimingScore.sampleCount, 1);
    });
    (0, node_test_1.it)("ev readiness Finding aktualisiert evReadinessMetRatePct", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_missed"] }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(next.evReadinessMetRatePct.value, 0);
        strict_1.default.equal(next.evReadinessMetRatePct.sampleCount, 1);
    });
    (0, node_test_1.it)("pv/price Scores aus EvaluationRecord.scores fließen ein, wenn value != null", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const record = baseRecord({
            scores: [
                { topic: "pv", value: 80, sampleCount: 1, basis: "self_consumed_share_of_pv" },
                { topic: "price", value: 60, sampleCount: 1, basis: "consumption_weighted_price_percentile" },
            ],
        });
        const next = (0, learning_js_1.applyDayToLearningState)(state, record, []);
        strict_1.default.equal(next.pvUtilizationPct.value, 80);
        strict_1.default.equal(next.priceEfficiencyScore.value, 60);
    });
    (0, node_test_1.it)("domain-basiert: global insufficient Tag (dayEvaluable=false) liefert trotzdem Battery-Sample, wenn dieses konklusiv ist (Korrektur #6)", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const record = baseRecord({ dayEvaluable: false, dayCoveragePct: 40 });
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
        ];
        const next = (0, learning_js_1.applyDayToLearningState)(state, record, findings);
        strict_1.default.equal(next.batteryReserveAccuracyPct.sampleCount, 1);
    });
    (0, node_test_1.it)("Idempotenz: derselbe (oder ein älterer) dateKey wird nicht doppelt eingerechnet", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
        ];
        const once = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), findings);
        strict_1.default.equal(once.lastProcessedDateKey, "2026-06-15");
        const again = (0, learning_js_1.applyDayToLearningState)(once, baseRecord(), findings);
        strict_1.default.equal(again.batteryReserveAccuracyPct.sampleCount, 1);
        strict_1.default.deepEqual(again, once);
        const older = (0, learning_js_1.applyDayToLearningState)(once, baseRecord({ dateKey: "2026-06-14" }), findings);
        strict_1.default.equal(older.batteryReserveAccuracyPct.sampleCount, 1);
        strict_1.default.deepEqual(older, once);
    });
    (0, node_test_1.it)("lastProcessedDateKey und updatedAtIso werden nach Verarbeitung fortgeschrieben", () => {
        const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
        const next = (0, learning_js_1.applyDayToLearningState)(state, baseRecord(), [], "2026-06-16T04:00:00.000Z");
        strict_1.default.equal(next.lastProcessedDateKey, "2026-06-15");
        strict_1.default.equal(next.updatedAtIso, "2026-06-16T04:00:00.000Z");
    });
});

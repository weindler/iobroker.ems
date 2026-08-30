"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_reserve_learning_js_1 = require("./battery_reserve_learning.js");
(0, node_test_1.describe)("Block B — Battery Learned Opportunity (batteryReserveAccuracyPct)", () => {
    (0, node_test_1.it)("Metrik fehlt (null) -> nicht usable, extraMarginCtPerKwh=0 (exakt bisheriges Verhalten)", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)(null);
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.gateReason, "battery_learning_metric_missing");
        strict_1.default.equal(r.extraMarginCtPerKwh, 0);
    });
    (0, node_test_1.it)("zu wenig Samples -> nicht usable, extraMarginCtPerKwh=0", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({
            value: 40,
            sampleCount: battery_reserve_learning_js_1.BATTERY_LEARNING_MIN_SAMPLE_COUNT - 1,
            confidencePct: 90,
        });
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.gateReason, "learning_gate_sample_count_low");
        strict_1.default.equal(r.extraMarginCtPerKwh, 0);
    });
    (0, node_test_1.it)("Confidence zu niedrig -> nicht usable, extraMarginCtPerKwh=0", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({
            value: 40,
            sampleCount: 50,
            confidencePct: battery_reserve_learning_js_1.BATTERY_LEARNING_MIN_CONFIDENCE_PCT - 1,
        });
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.gateReason, "learning_gate_confidence_low");
        strict_1.default.equal(r.extraMarginCtPerKwh, 0);
    });
    (0, node_test_1.it)("ungueltiger Wert (ausserhalb 0..100) -> nicht usable, extraMarginCtPerKwh=0", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 140, sampleCount: 50, confidencePct: 90 });
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.gateReason, "battery_learning_value_invalid");
        strict_1.default.equal(r.extraMarginCtPerKwh, 0);
    });
    (0, node_test_1.it)("Reserve historisch voll zuverlaessig (>= FULL_TRUST) -> keine Zusatzmarge", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({
            value: battery_reserve_learning_js_1.BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT,
            sampleCount: 50,
            confidencePct: 90,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.extraMarginCtPerKwh, 0);
    });
    (0, node_test_1.it)("Reserve historisch unzuverlaessig (0 %) -> maximale Zusatzmarge, nie mehr", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 0, sampleCount: 50, confidencePct: 90 });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.extraMarginCtPerKwh, battery_reserve_learning_js_1.BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH);
    });
    (0, node_test_1.it)("mittlerer Trefferanteil -> Zusatzmarge liegt strikt zwischen 0 und Max", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 45, sampleCount: 50, confidencePct: 90 });
        strict_1.default.equal(r.usable, true);
        strict_1.default.ok(r.extraMarginCtPerKwh > 0);
        strict_1.default.ok(r.extraMarginCtPerKwh < battery_reserve_learning_js_1.BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH);
    });
    (0, node_test_1.it)("Zusatzmarge ist niemals negativ, auch bei Wert > FULL_TRUST", () => {
        const r = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 99, sampleCount: 50, confidencePct: 90 });
        strict_1.default.equal(r.usable, true);
        strict_1.default.ok(r.extraMarginCtPerKwh >= 0);
    });
    (0, node_test_1.describe)("toBatteryReserveLearningExplanation", () => {
        (0, node_test_1.it)("nicht usable -> changedByLearning immer false, unabhaengig von Baseline/Adjusted-Diff", () => {
            const calibration = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)(null);
            const explanation = (0, battery_reserve_learning_js_1.toBatteryReserveLearningExplanation)(calibration, true, false);
            strict_1.default.equal(explanation.changedByLearning, false);
            strict_1.default.equal(explanation.baselineDecision, true);
            strict_1.default.equal(explanation.adjustedDecision, false);
            strict_1.default.deepEqual(explanation.reasonCodes, []);
        });
        (0, node_test_1.it)("usable + Entscheidung tatsaechlich veraendert -> changedByLearning=true", () => {
            const calibration = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 0, sampleCount: 50, confidencePct: 90 });
            const explanation = (0, battery_reserve_learning_js_1.toBatteryReserveLearningExplanation)(calibration, true, false);
            strict_1.default.equal(explanation.changedByLearning, true);
            strict_1.default.deepEqual(explanation.reasonCodes, ["battery_reserve_learning_margin_increased"]);
            strict_1.default.equal(explanation.learningMetrics.length, 1);
            strict_1.default.equal(explanation.learningMetrics[0].name, "batteryReserveAccuracyPct");
        });
        (0, node_test_1.it)("usable, aber Entscheidung unveraendert (Marge reichte fuer keine Aenderung) -> changedByLearning=false", () => {
            const calibration = (0, battery_reserve_learning_js_1.calibrateBatteryOpportunityMargin)({ value: 20, sampleCount: 50, confidencePct: 90 });
            const explanation = (0, battery_reserve_learning_js_1.toBatteryReserveLearningExplanation)(calibration, true, true);
            strict_1.default.equal(explanation.changedByLearning, false);
        });
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_opportunity_gate_js_1 = require("./thermal_opportunity_gate.js");
function pvSlot(startIso, endIso, kwh) {
    return {
        slot: { startIso, endIso },
        forecastPowerW: null,
        observedPowerW: null,
        energyKwh: kwh,
    };
}
/** 8 Slots — Kandidat (idx 2) niedrig, weit später (idx 6) deutlich höher. */
function slots() {
    const base = Date.parse("2026-06-15T08:00:00.000Z");
    const kwhByIdx = [0.1, 0.1, 0.1, 0.1, 2.0, 2.5, 3.0, 0.2];
    return kwhByIdx.map((kwh, i) => {
        const startMs = base + i * 3600_000;
        return pvSlot(new Date(startMs).toISOString(), new Date(startMs + 3600_000).toISOString(), kwh);
    });
}
(0, node_test_1.describe)("Block B — thermal opportunity gate", () => {
    (0, node_test_1.it)("deutlich besseres PV-Fenster vor Deadline gefunden → defer=true", () => {
        const s = slots();
        const candidateMs = Date.parse(s[2].slot.startIso);
        const emptyAtMs = Date.parse(s[7].slot.startIso) + 1; // nach Slot 6 (das bessere Fenster)
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: candidateMs,
            thermalEmptyAtMs: emptyAtMs,
            pvSlots: s,
            pvForecastConfidence01: 0.9,
        });
        strict_1.default.equal(r.defer, true);
        strict_1.default.equal(r.reasonCode, "thermal_significant_better_pv_window_before_empty");
    });
    (0, node_test_1.it)("besseres Fenster liegt NACH thermalEmptyAtIso → kein Defer", () => {
        const s = slots();
        const candidateMs = Date.parse(s[2].slot.startIso);
        // Deadline knapp vor dem besseren Fenster (Slot 4) — das bessere Fenster ist nicht mehr erreichbar.
        const emptyAtMs = Date.parse(s[4].slot.startIso);
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: candidateMs,
            thermalEmptyAtMs: emptyAtMs,
            pvSlots: s,
            pvForecastConfidence01: 0.9,
        });
        strict_1.default.equal(r.defer, false);
    });
    (0, node_test_1.it)("keine Deadline bekannt (thermalEmptyAtMs=null) → kein Defer (Fallback)", () => {
        const s = slots();
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: Date.parse(s[2].slot.startIso),
            thermalEmptyAtMs: null,
            pvSlots: s,
            pvForecastConfidence01: 0.9,
        });
        strict_1.default.equal(r.defer, false);
        strict_1.default.equal(r.reasonCode, null);
    });
    (0, node_test_1.it)("PV-Forecast-Confidence unter Learning-Gate-Schwelle → kein Defer, Reason-Code gesetzt", () => {
        const s = slots();
        const candidateMs = Date.parse(s[2].slot.startIso);
        const emptyAtMs = Date.parse(s[7].slot.startIso) + 1;
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: candidateMs,
            thermalEmptyAtMs: emptyAtMs,
            pvSlots: s,
            pvForecastConfidence01: 0.2, // 20 % < 50 % Schwelle
        });
        strict_1.default.equal(r.defer, false);
        strict_1.default.equal(r.reasonCode, "learning_gate_confidence_low");
    });
    (0, node_test_1.it)("Confidence unbekannt (null) → kein Defer, learning_gate_signal_unknown", () => {
        const s = slots();
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: Date.parse(s[2].slot.startIso),
            thermalEmptyAtMs: Date.parse(s[7].slot.startIso) + 1,
            pvSlots: s,
            pvForecastConfidence01: null,
        });
        strict_1.default.equal(r.defer, false);
        strict_1.default.equal(r.reasonCode, "learning_gate_signal_unknown");
    });
    (0, node_test_1.it)("nur knapp bessere Fenster (< Perzentil-Lücke) → kein Defer", () => {
        const base = Date.parse("2026-06-15T08:00:00.000Z");
        // 24 streng monoton steigende, gleichmäßig verteilte Werte → Perzentil-Schrittweite 1/24
        // (≈0.042). Deadline schneidet nach 4 Slots ab (max. Lücke 4/24 ≈ 0.167 < 0.3-Schwelle).
        const s = Array.from({ length: 24 }, (_, i) => {
            const startMs = base + i * 3600_000;
            return pvSlot(new Date(startMs).toISOString(), new Date(startMs + 3600_000).toISOString(), i * 0.1);
        });
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: Date.parse(s[10].slot.startIso),
            thermalEmptyAtMs: Date.parse(s[14].slot.startIso) + 1,
            pvSlots: s,
            pvForecastConfidence01: 0.9,
        });
        strict_1.default.equal(r.defer, false);
    });
    (0, node_test_1.it)("Kandidat ist bereits das beste Fenster → kein Defer", () => {
        const s = slots();
        // Slot 6 hat den höchsten kWh-Wert der Serie.
        const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
            candidateSlotStartMs: Date.parse(s[6].slot.startIso),
            thermalEmptyAtMs: Date.parse(s[7].slot.startIso) + 1,
            pvSlots: s,
            pvForecastConfidence01: 0.9,
        });
        strict_1.default.equal(r.defer, false);
    });
    (0, node_test_1.it)("Konstante bleibt bei 0.3 (muss mit Block-A-Evaluator synchron sein)", () => {
        strict_1.default.equal(thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP, 0.3);
    });
    (0, node_test_1.describe)("LEARNED PLANNER — calibrateThermalOpportunityGap (Block-A thermalPriceTimingScore)", () => {
        (0, node_test_1.it)("Metrik fehlt (null) → nicht usable, effectiveGap === baselineGap (Fallback)", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)(null);
            strict_1.default.equal(c.usable, false);
            strict_1.default.equal(c.gateReason, "thermal_learning_metric_missing");
            strict_1.default.equal(c.effectiveGap, thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
            strict_1.default.equal(c.baselineGap, thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
        });
        (0, node_test_1.it)("zu wenig Samples → nicht usable, effectiveGap unverändert", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({
                value: 90,
                sampleCount: thermal_opportunity_gate_js_1.THERMAL_LEARNING_MIN_SAMPLE_COUNT - 1,
                confidencePct: 90,
            });
            strict_1.default.equal(c.usable, false);
            strict_1.default.equal(c.gateReason, "learning_gate_sample_count_low");
            strict_1.default.equal(c.effectiveGap, thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
        });
        (0, node_test_1.it)("Confidence zu niedrig → nicht usable, effectiveGap unverändert", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({
                value: 90,
                sampleCount: 50,
                confidencePct: thermal_opportunity_gate_js_1.THERMAL_LEARNING_MIN_CONFIDENCE_PCT - 1,
            });
            strict_1.default.equal(c.usable, false);
            strict_1.default.equal(c.gateReason, "learning_gate_confidence_low");
        });
        (0, node_test_1.it)("ungültiger Wert (außerhalb 0..100) → nicht usable", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({ value: 150, sampleCount: 50, confidencePct: 90 });
            strict_1.default.equal(c.usable, false);
            strict_1.default.equal(c.gateReason, "thermal_learning_value_invalid");
        });
        (0, node_test_1.it)("hoher Score (gutes historisches Timing) → Schwelle sinkt, bleibt aber >= GAP_MIN", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({ value: 100, sampleCount: 50, confidencePct: 90 });
            strict_1.default.equal(c.usable, true);
            strict_1.default.ok(c.effectiveGap < thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
            strict_1.default.ok(c.effectiveGap >= thermal_opportunity_gate_js_1.THERMAL_LEARNING_GAP_MIN);
        });
        (0, node_test_1.it)("niedriger Score (schlechtes historisches Timing) → Schwelle steigt, bleibt aber <= GAP_MAX", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({ value: 0, sampleCount: 50, confidencePct: 90 });
            strict_1.default.equal(c.usable, true);
            strict_1.default.ok(c.effectiveGap > thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
            strict_1.default.ok(c.effectiveGap <= thermal_opportunity_gate_js_1.THERMAL_LEARNING_GAP_MAX);
        });
        (0, node_test_1.it)("Score genau 50 (neutral) → effectiveGap === baselineGap", () => {
            const c = (0, thermal_opportunity_gate_js_1.calibrateThermalOpportunityGap)({ value: 50, sampleCount: 50, confidencePct: 90 });
            strict_1.default.equal(c.usable, true);
            strict_1.default.equal(c.effectiveGap, thermal_opportunity_gate_js_1.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
        });
    });
    (0, node_test_1.describe)("LEARNED PLANNER — evaluateThermalDeferOpportunity mit learnedPriceTimingScore", () => {
        (0, node_test_1.it)("niedriger Score senkt effektiv die Schwelle nicht unter das Ergebnis ohne Learning: nur knapp bessere Fenster (< 0.3, aber >= niedrigerer effektiver Gap durch hohen Score) → changedByLearning=true", () => {
            // 24 gleichmäßig verteilte Werte → Perzentil-Schrittweite 1/24 (~0.0417).
            // Lücke von genau 5 Slots ≈ 5/24 ≈ 0.208 — < 0.3 (baseline), aber >= 0.2 (GAP_MIN bei Score=100).
            const base = Date.parse("2026-06-15T08:00:00.000Z");
            const s = Array.from({ length: 24 }, (_, i) => {
                const startMs = base + i * 3600_000;
                return {
                    slot: { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + 3600_000).toISOString() },
                    forecastPowerW: null,
                    observedPowerW: null,
                    energyKwh: i * 0.1,
                };
            });
            const candidateMs = Date.parse(s[5].slot.startIso);
            const emptyAtMs = Date.parse(s[10].slot.startIso) + 1;
            const withoutLearning = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
                candidateSlotStartMs: candidateMs,
                thermalEmptyAtMs: emptyAtMs,
                pvSlots: s,
                pvForecastConfidence01: 0.9,
            });
            strict_1.default.equal(withoutLearning.baselineDefer, false);
            strict_1.default.equal(withoutLearning.changedByLearning, false);
            const withLearning = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
                candidateSlotStartMs: candidateMs,
                thermalEmptyAtMs: emptyAtMs,
                pvSlots: s,
                pvForecastConfidence01: 0.9,
                learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: 90 },
            });
            strict_1.default.equal(withLearning.baselineDefer, false);
            strict_1.default.equal(withLearning.adjustedDefer, true);
            strict_1.default.equal(withLearning.defer, true);
            strict_1.default.equal(withLearning.changedByLearning, true);
            strict_1.default.equal(withLearning.learning.usable, true);
        });
        (0, node_test_1.it)("Learning-Metrik nicht usable (fehlende Confidence) → adjustedDefer === baselineDefer, changedByLearning=false", () => {
            const s = slots();
            const candidateMs = Date.parse(s[2].slot.startIso);
            const emptyAtMs = Date.parse(s[7].slot.startIso) + 1;
            const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
                candidateSlotStartMs: candidateMs,
                thermalEmptyAtMs: emptyAtMs,
                pvSlots: s,
                pvForecastConfidence01: 0.9,
                learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: null },
            });
            strict_1.default.equal(r.baselineDefer, r.adjustedDefer);
            strict_1.default.equal(r.changedByLearning, false);
            strict_1.default.equal(r.learning.usable, false);
        });
        (0, node_test_1.it)("toThermalLearningExplanation: null-Result → null", () => {
            strict_1.default.equal((0, thermal_opportunity_gate_js_1.toThermalLearningExplanation)(null), null);
            strict_1.default.equal((0, thermal_opportunity_gate_js_1.toThermalLearningExplanation)(undefined), null);
        });
        (0, node_test_1.it)("toThermalLearningExplanation: usable + verändert → changedByLearning=true, Metrik enthalten", () => {
            const s = slots();
            const emptyAtMs = Date.parse(s[7].slot.startIso) + 1;
            const r = (0, thermal_opportunity_gate_js_1.evaluateThermalDeferOpportunity)({
                candidateSlotStartMs: Date.parse(s[2].slot.startIso),
                thermalEmptyAtMs: emptyAtMs,
                pvSlots: s,
                pvForecastConfidence01: 0.9,
                learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: 90 },
            });
            const explanation = (0, thermal_opportunity_gate_js_1.toThermalLearningExplanation)(r);
            strict_1.default.ok(explanation);
            strict_1.default.equal(explanation.baselineDecision, r.baselineDefer);
            strict_1.default.equal(explanation.adjustedDecision, r.adjustedDefer);
            strict_1.default.equal(explanation.learningMetrics[0].name, "thermalPriceTimingScore");
        });
    });
});

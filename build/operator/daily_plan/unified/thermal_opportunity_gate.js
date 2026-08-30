"use strict";
/**
 * BLOCK B — Thermal Opportunity Gate für den Unified Day Planner.
 *
 * Beantwortet für den OPTIONALEN (Soft-)Heizstab-Anteil: "muss er in diesem Slot laufen,
 * oder kann er sicher auf ein deutlich besseres PV-Fenster vor `thermalEmptyAtIso` warten?"
 *
 * Fachliches Muster (Perzentil-Lücke) identisch zum eingefrorenen Block-A-Evaluator
 * (`learning/daily_evaluator/thermal_findings.ts`, `SIGNIFICANT_PERCENTILE_GAP`), damit
 * Planner und Evaluator keinen abweichenden Begriff von "besseres Fenster" entwickeln.
 * Block A ist abgenommen/eingefroren und wird NICHT importiert oder verändert — daher eine
 * eigenständige, aber wertgleiche Kopie. Bei Änderung eines der beiden Schwellenwerte muss
 * der andere manuell nachgezogen werden (siehe Kommentar an der Konstante).
 *
 * Nur additiv genutzt (Score-Malus in score_allocate.ts), kein harter Veto-Pfad — die
 * bestehende Earliness/Pressure-Ökonomie bleibt für echte Deadline-Nähe unverändert
 * wirksam ("wenn thermalEmptyAtIso vorher droht: nicht künstlich warten").
 *
 * LEARNED PLANNER (Finalisierung): Der Perzentil-Schwellenwert selbst darf innerhalb enger,
 * fest gebundener Grenzen durch die tatsächliche Block-A-Metrik `thermalPriceTimingScore`
 * kalibriert werden (siehe `calibrateThermalOpportunityGap`) — NIE über den bestehenden
 * `thermalEmptyAtMs`-Hard-Check hinaus, NIE ohne Learning-Gate. Ohne übergebene/valide/
 * ausreichend belastbare Metrik ist `effectiveGap === baselineGap` — exakt bisheriges
 * Verhalten (Fallback).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toThermalLearningExplanation = exports.evaluateThermalDeferOpportunity = exports.calibrateThermalOpportunityGap = exports.THERMAL_LEARNING_GAP_ADJUST_MAX = exports.THERMAL_LEARNING_GAP_MAX = exports.THERMAL_LEARNING_GAP_MIN = exports.THERMAL_LEARNING_MIN_CONFIDENCE_PCT = exports.THERMAL_LEARNING_MIN_SAMPLE_COUNT = exports.THERMAL_OPPORTUNITY_DEFER_SCORE_WEIGHT = exports.THERMAL_OPPORTUNITY_MIN_PV_CONFIDENCE_PCT = exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP = void 0;
const learning_gate_1 = require("./learning_gate");
/**
 * Muss dem Block-A-Schwellenwert entsprechen (`SIGNIFICANT_PERCENTILE_GAP` in
 * `learning/daily_evaluator/thermal_findings.ts`) — bei Änderung dort synchron anpassen.
 */
exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP = 0.3;
/** Learning Gate: PV-Forecast-Confidence unter dieser Schwelle → Fallback (kein Defer). */
exports.THERMAL_OPPORTUNITY_MIN_PV_CONFIDENCE_PCT = 50;
/** Score-Malus-Gewicht, wenn ein deutlich besseres Fenster gefunden wurde (siehe score_allocate.ts). */
exports.THERMAL_OPPORTUNITY_DEFER_SCORE_WEIGHT = 3.5;
/*
 * LEARNED CALIBRATION — Bounds für die Block-A-gestützte Anpassung des Perzentil-
 * Schwellenwerts. Baseline bleibt immer 0.3; die gelernte `thermalPriceTimingScore`
 * (0..100, Rückblick-Score früherer preis-/PV-getimter Heizstab-Entscheidungen) darf den
 * effektiven Schwellenwert um höchstens ±0.1 verschieben und nie außerhalb [0.2, 0.4] liegen.
 * Hoher Score (historisch gute Timing-Entscheidungen) → Schwelle sinkt leicht (Planner darf
 * etwas leichter defern). Niedriger Score (historisch avoidable/wasteful) → Schwelle steigt
 * (Planner defert vorsichtiger). Reine Kalibrierung, kein neues Kriterium.
 */
exports.THERMAL_LEARNING_MIN_SAMPLE_COUNT = 10;
exports.THERMAL_LEARNING_MIN_CONFIDENCE_PCT = 50;
exports.THERMAL_LEARNING_GAP_MIN = 0.2;
exports.THERMAL_LEARNING_GAP_MAX = 0.4;
exports.THERMAL_LEARNING_GAP_ADJUST_MAX = 0.1;
function percentileRank(values, value) {
    if (!Number.isFinite(value) || values.length < 4)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    let below = 0;
    for (const v of sorted)
        if (v < value)
            below++;
    return below / sorted.length;
}
function isValidPct(n) {
    return n == null || (Number.isFinite(n) && n >= 0 && n <= 100);
}
function unusableCalibration(gateReason, metric) {
    return {
        usable: false,
        gateReason,
        value: metric?.value ?? null,
        sampleCount: metric?.sampleCount ?? null,
        confidencePct: metric?.confidencePct ?? null,
        effectiveGap: exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
        baselineGap: exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
    };
}
/**
 * Kalibriert den Perzentil-Schwellenwert anhand der tatsächlichen Block-A-Metrik
 * `thermalPriceTimingScore` (0..100). Läuft immer durch das zentrale Learning Gate
 * (`evaluateLearningGate`) — nicht usable (fehlend/zu wenig Samples/zu wenig Confidence/
 * ungültiger Wert) → `effectiveGap === baselineGap` (exakt bisheriges Verhalten).
 */
function calibrateThermalOpportunityGap(metric) {
    if (!metric) {
        return unusableCalibration("thermal_learning_metric_missing", null);
    }
    const { value, sampleCount, confidencePct } = metric;
    if (value == null ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100 ||
        !isValidPct(confidencePct) ||
        (sampleCount != null && (!Number.isFinite(sampleCount) || sampleCount < 0))) {
        return unusableCalibration("thermal_learning_value_invalid", metric);
    }
    const gate = (0, learning_gate_1.evaluateLearningGate)({ sampleCount, confidencePct }, { minSampleCount: exports.THERMAL_LEARNING_MIN_SAMPLE_COUNT, minConfidencePct: exports.THERMAL_LEARNING_MIN_CONFIDENCE_PCT });
    if (!gate.usable) {
        return unusableCalibration(gate.reasonCode, metric);
    }
    // 0..100 → -1..+1 (0=schlecht/wasteful, 100=gut/necessary). Guter Score senkt die Schwelle
    // (leichter defern), schlechter Score erhöht sie (vorsichtiger) — nie über die Bounds hinaus.
    const normalized = (value - 50) / 50;
    const deviation = -normalized * exports.THERMAL_LEARNING_GAP_ADJUST_MAX;
    const effectiveGap = (0, learning_gate_1.clampToBounds)(exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP + deviation, exports.THERMAL_LEARNING_GAP_MIN, exports.THERMAL_LEARNING_GAP_MAX);
    return {
        usable: true,
        gateReason: null,
        value,
        sampleCount,
        confidencePct,
        effectiveGap,
        baselineGap: exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
    };
}
exports.calibrateThermalOpportunityGap = calibrateThermalOpportunityGap;
function noOpportunityResult(reasonCode, learning) {
    return {
        defer: false,
        reasonCode,
        baselineDefer: false,
        adjustedDefer: false,
        changedByLearning: false,
        learning,
    };
}
/**
 * `true` (adjustedDefer), wenn zwischen `candidateSlotStartMs` (exklusiv) und
 * `thermalEmptyAtMs` (exklusiv) ein PV-Slot existiert, dessen Perzentil um mindestens den
 * (ggf. Block-A-kalibrierten) Schwellenwert besser ist als am Kandidaten-Slot selbst — UND
 * das Learning Gate (PV-Forecast-Confidence) erfüllt ist. Sonst `false` (Fallback =
 * bisheriges Scoring, unverändert). `baselineDefer` verwendet dabei immer den festen
 * 0.3-Schwellenwert — unabhängig von einer ggf. vorhandenen Learning-Kalibrierung.
 */
function evaluateThermalDeferOpportunity(input) {
    const { candidateSlotStartMs, thermalEmptyAtMs, pvSlots } = input;
    const emptyCalibration = unusableCalibration("thermal_learning_metric_missing", null);
    if (thermalEmptyAtMs == null || !Number.isFinite(thermalEmptyAtMs)) {
        return noOpportunityResult(null, emptyCalibration);
    }
    if (!(candidateSlotStartMs < thermalEmptyAtMs)) {
        return noOpportunityResult(null, emptyCalibration);
    }
    const gate = (0, learning_gate_1.evaluateLearningGate)({ sampleCount: null, confidencePct: input.pvForecastConfidence01 == null ? null : input.pvForecastConfidence01 * 100 }, { minSampleCount: 0, minConfidencePct: exports.THERMAL_OPPORTUNITY_MIN_PV_CONFIDENCE_PCT });
    if (!gate.usable) {
        return noOpportunityResult(gate.reasonCode, emptyCalibration);
    }
    const points = [];
    for (const s of pvSlots) {
        const startMs = Date.parse(s.slot.startIso);
        const kwh = s.energyKwh;
        if (!Number.isFinite(startMs) || kwh == null || !Number.isFinite(kwh))
            continue;
        points.push({ startMs, kwh });
    }
    if (points.length < 4)
        return noOpportunityResult(null, emptyCalibration);
    const allKwh = points.map((p) => p.kwh);
    const own = points.find((p) => p.startMs === candidateSlotStartMs);
    if (!own)
        return noOpportunityResult(null, emptyCalibration);
    const ownPercentile = percentileRank(allKwh, own.kwh);
    if (ownPercentile == null)
        return noOpportunityResult(null, emptyCalibration);
    const calibration = calibrateThermalOpportunityGap(input.learnedPriceTimingScore);
    let baselineDefer = false;
    let adjustedDefer = false;
    for (const p of points) {
        if (!(p.startMs > candidateSlotStartMs) || !(p.startMs < thermalEmptyAtMs))
            continue;
        const pct = percentileRank(allKwh, p.kwh);
        if (pct == null)
            continue;
        const gap = pct - ownPercentile;
        if (gap >= exports.THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP)
            baselineDefer = true;
        if (gap >= calibration.effectiveGap)
            adjustedDefer = true;
    }
    const reasonCode = adjustedDefer || baselineDefer ? "thermal_significant_better_pv_window_before_empty" : null;
    const changedByLearning = calibration.usable && baselineDefer !== adjustedDefer;
    return {
        defer: adjustedDefer,
        reasonCode,
        baselineDefer,
        adjustedDefer,
        changedByLearning,
        learning: calibration,
    };
}
exports.evaluateThermalDeferOpportunity = evaluateThermalDeferOpportunity;
/**
 * Übersetzt ein `ThermalOpportunityGateResult` in die gemeinsame, kleine
 * `PlannerLearningExplanation`-Struktur (siehe `learning_explanation.ts`) — rein
 * diagnostisch, für kompakte Explainability-States (`planner.learning.thermal_explanation`).
 */
function toThermalLearningExplanation(result) {
    if (!result)
        return null;
    return {
        baselineDecision: result.baselineDefer,
        adjustedDecision: result.adjustedDefer,
        changedByLearning: result.changedByLearning,
        reasonCodes: result.reasonCode ? [result.reasonCode] : [],
        confidencePct: result.learning.confidencePct,
        learningMetrics: [
            {
                name: "thermalPriceTimingScore",
                value: result.learning.value,
                sampleCount: result.learning.sampleCount,
                confidencePct: result.learning.confidencePct,
                usable: result.learning.usable,
                gateReason: result.learning.gateReason,
            },
        ],
    };
}
exports.toThermalLearningExplanation = toThermalLearningExplanation;

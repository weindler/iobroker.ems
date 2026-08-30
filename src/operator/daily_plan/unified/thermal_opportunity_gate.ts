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

import { clampToBounds, evaluateLearningGate, type LearningGateReasonCode } from "./learning_gate";
import type { PlannerLearningExplanation } from "./learning_explanation";
import type { UnifiedPvSlot } from "./types";

/**
 * Muss dem Block-A-Schwellenwert entsprechen (`SIGNIFICANT_PERCENTILE_GAP` in
 * `learning/daily_evaluator/thermal_findings.ts`) — bei Änderung dort synchron anpassen.
 */
export const THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP = 0.3;

/** Learning Gate: PV-Forecast-Confidence unter dieser Schwelle → Fallback (kein Defer). */
export const THERMAL_OPPORTUNITY_MIN_PV_CONFIDENCE_PCT = 50;

/** Score-Malus-Gewicht, wenn ein deutlich besseres Fenster gefunden wurde (siehe score_allocate.ts). */
export const THERMAL_OPPORTUNITY_DEFER_SCORE_WEIGHT = 3.5;

/*
 * LEARNED CALIBRATION — Bounds für die Block-A-gestützte Anpassung des Perzentil-
 * Schwellenwerts. Baseline bleibt immer 0.3; die gelernte `thermalPriceTimingScore`
 * (0..100, Rückblick-Score früherer preis-/PV-getimter Heizstab-Entscheidungen) darf den
 * effektiven Schwellenwert um höchstens ±0.1 verschieben und nie außerhalb [0.2, 0.4] liegen.
 * Hoher Score (historisch gute Timing-Entscheidungen) → Schwelle sinkt leicht (Planner darf
 * etwas leichter defern). Niedriger Score (historisch avoidable/wasteful) → Schwelle steigt
 * (Planner defert vorsichtiger). Reine Kalibrierung, kein neues Kriterium.
 */
export const THERMAL_LEARNING_MIN_SAMPLE_COUNT = 10;
export const THERMAL_LEARNING_MIN_CONFIDENCE_PCT = 50;
export const THERMAL_LEARNING_GAP_MIN = 0.2;
export const THERMAL_LEARNING_GAP_MAX = 0.4;
export const THERMAL_LEARNING_GAP_ADJUST_MAX = 0.1;

export type ThermalLearningGateReason =
	| LearningGateReasonCode
	| "thermal_learning_metric_missing"
	| "thermal_learning_value_invalid";

export type ThermalOpportunityReasonCode =
	| "thermal_significant_better_pv_window_before_empty"
	| LearningGateReasonCode;

export type ThermalOpportunityGateResult = {
	/** = adjustedDefer — für bestehende Call-Sites unverändert (Score-Malus-Trigger). */
	defer: boolean;
	reasonCode: ThermalOpportunityReasonCode | null;
	/** Entscheidung OHNE Block-A-Learning-Kalibrierung (bisheriges Verhalten, fester 0.3-Gap). */
	baselineDefer: boolean;
	/** Tatsächlich verwendete Entscheidung (inkl. usable Block-A-Learning, falls vorhanden). */
	adjustedDefer: boolean;
	/**
	 * true NUR wenn die Learning-Metrik usable war UND sich dadurch adjustedDefer von
	 * baselineDefer tatsächlich unterscheidet (nicht schon bei bloßem Lesen/Gate-Pass).
	 */
	changedByLearning: boolean;
	/** Explainability der Learning-Kalibrierung — siehe `calibrateThermalOpportunityGap`. */
	learning: ThermalLearningCalibration;
};

function percentileRank(values: number[], value: number): number | null {
	if (!Number.isFinite(value) || values.length < 4) return null;
	const sorted = [...values].sort((a, b) => a - b);
	let below = 0;
	for (const v of sorted) if (v < value) below++;
	return below / sorted.length;
}

function isValidPct(n: number | null): boolean {
	return n == null || (Number.isFinite(n) && n >= 0 && n <= 100);
}

/** Primitive, Block-A-entkoppelte Sicht auf eine einzelne `LearningMetric` (siehe daily_evaluator/types.ts). */
export type ThermalLearningMetricInput = {
	value: number | null;
	sampleCount: number | null;
	confidencePct: number | null;
};

export type ThermalLearningCalibration = {
	usable: boolean;
	gateReason: ThermalLearningGateReason | null;
	value: number | null;
	sampleCount: number | null;
	confidencePct: number | null;
	/** Tatsächlich verwendeter Gap-Schwellenwert (= baselineGap, wenn !usable). */
	effectiveGap: number;
	/** Fester Referenzwert, immer 0.3 — für Explainability/Tests. */
	baselineGap: number;
};

function unusableCalibration(
	gateReason: ThermalLearningGateReason | null,
	metric?: ThermalLearningMetricInput | null,
): ThermalLearningCalibration {
	return {
		usable: false,
		gateReason,
		value: metric?.value ?? null,
		sampleCount: metric?.sampleCount ?? null,
		confidencePct: metric?.confidencePct ?? null,
		effectiveGap: THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
		baselineGap: THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
	};
}

/**
 * Kalibriert den Perzentil-Schwellenwert anhand der tatsächlichen Block-A-Metrik
 * `thermalPriceTimingScore` (0..100). Läuft immer durch das zentrale Learning Gate
 * (`evaluateLearningGate`) — nicht usable (fehlend/zu wenig Samples/zu wenig Confidence/
 * ungültiger Wert) → `effectiveGap === baselineGap` (exakt bisheriges Verhalten).
 */
export function calibrateThermalOpportunityGap(
	metric: ThermalLearningMetricInput | null | undefined,
): ThermalLearningCalibration {
	if (!metric) {
		return unusableCalibration("thermal_learning_metric_missing", null);
	}
	const { value, sampleCount, confidencePct } = metric;
	if (
		value == null ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 100 ||
		!isValidPct(confidencePct) ||
		(sampleCount != null && (!Number.isFinite(sampleCount) || sampleCount < 0))
	) {
		return unusableCalibration("thermal_learning_value_invalid", metric);
	}

	const gate = evaluateLearningGate(
		{ sampleCount, confidencePct },
		{ minSampleCount: THERMAL_LEARNING_MIN_SAMPLE_COUNT, minConfidencePct: THERMAL_LEARNING_MIN_CONFIDENCE_PCT },
	);
	if (!gate.usable) {
		return unusableCalibration(gate.reasonCode, metric);
	}

	// 0..100 → -1..+1 (0=schlecht/wasteful, 100=gut/necessary). Guter Score senkt die Schwelle
	// (leichter defern), schlechter Score erhöht sie (vorsichtiger) — nie über die Bounds hinaus.
	const normalized = (value - 50) / 50;
	const deviation = -normalized * THERMAL_LEARNING_GAP_ADJUST_MAX;
	const effectiveGap = clampToBounds(
		THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP + deviation,
		THERMAL_LEARNING_GAP_MIN,
		THERMAL_LEARNING_GAP_MAX,
	);
	return {
		usable: true,
		gateReason: null,
		value,
		sampleCount,
		confidencePct,
		effectiveGap,
		baselineGap: THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
	};
}

export type ThermalOpportunityGateInput = {
	/** Startzeit (ms) des zu bewertenden Kandidaten-Slots. */
	candidateSlotStartMs: number;
	/** `thermalEmptyAtIso` als ms; null = keine belastbare Deadline bekannt → kein Defer. */
	thermalEmptyAtMs: number | null;
	/** Bekannte PV-Slots (Forecast) des aktuellen Planungslaufs. */
	pvSlots: UnifiedPvSlot[];
	/** 0..1 — PV-Forecast-Confidence (`pv.uncertainty.confidencePct / 100`, bereits vorhanden). */
	pvForecastConfidence01: number | null;
	/**
	 * Optional (additiv): tatsächliche Block-A-Metrik `thermalPriceTimingScore` — kalibriert
	 * den Perzentil-Schwellenwert (siehe `calibrateThermalOpportunityGap`). Fehlt sie
	 * (`undefined`/`null`) oder ist sie nicht usable → exakt bisheriges Verhalten.
	 */
	learnedPriceTimingScore?: ThermalLearningMetricInput | null;
};

function noOpportunityResult(
	reasonCode: ThermalOpportunityReasonCode | null,
	learning: ThermalLearningCalibration,
): ThermalOpportunityGateResult {
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
export function evaluateThermalDeferOpportunity(
	input: ThermalOpportunityGateInput,
): ThermalOpportunityGateResult {
	const { candidateSlotStartMs, thermalEmptyAtMs, pvSlots } = input;
	const emptyCalibration = unusableCalibration("thermal_learning_metric_missing", null);
	if (thermalEmptyAtMs == null || !Number.isFinite(thermalEmptyAtMs)) {
		return noOpportunityResult(null, emptyCalibration);
	}
	if (!(candidateSlotStartMs < thermalEmptyAtMs)) {
		return noOpportunityResult(null, emptyCalibration);
	}

	const gate = evaluateLearningGate(
		{ sampleCount: null, confidencePct: input.pvForecastConfidence01 == null ? null : input.pvForecastConfidence01 * 100 },
		{ minSampleCount: 0, minConfidencePct: THERMAL_OPPORTUNITY_MIN_PV_CONFIDENCE_PCT },
	);
	if (!gate.usable) {
		return noOpportunityResult(gate.reasonCode, emptyCalibration);
	}

	const points: Array<{ startMs: number; kwh: number }> = [];
	for (const s of pvSlots) {
		const startMs = Date.parse(s.slot.startIso);
		const kwh = s.energyKwh;
		if (!Number.isFinite(startMs) || kwh == null || !Number.isFinite(kwh)) continue;
		points.push({ startMs, kwh });
	}
	if (points.length < 4) return noOpportunityResult(null, emptyCalibration);

	const allKwh = points.map((p) => p.kwh);
	const own = points.find((p) => p.startMs === candidateSlotStartMs);
	if (!own) return noOpportunityResult(null, emptyCalibration);
	const ownPercentile = percentileRank(allKwh, own.kwh);
	if (ownPercentile == null) return noOpportunityResult(null, emptyCalibration);

	const calibration = calibrateThermalOpportunityGap(input.learnedPriceTimingScore);

	let baselineDefer = false;
	let adjustedDefer = false;
	for (const p of points) {
		if (!(p.startMs > candidateSlotStartMs) || !(p.startMs < thermalEmptyAtMs)) continue;
		const pct = percentileRank(allKwh, p.kwh);
		if (pct == null) continue;
		const gap = pct - ownPercentile;
		if (gap >= THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP) baselineDefer = true;
		if (gap >= calibration.effectiveGap) adjustedDefer = true;
	}

	const reasonCode: ThermalOpportunityReasonCode | null =
		adjustedDefer || baselineDefer ? "thermal_significant_better_pv_window_before_empty" : null;
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

/**
 * Übersetzt ein `ThermalOpportunityGateResult` in die gemeinsame, kleine
 * `PlannerLearningExplanation`-Struktur (siehe `learning_explanation.ts`) — rein
 * diagnostisch, für kompakte Explainability-States (`planner.learning.thermal_explanation`).
 */
export function toThermalLearningExplanation(
	result: ThermalOpportunityGateResult | null | undefined,
): PlannerLearningExplanation<boolean> | null {
	if (!result) return null;
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

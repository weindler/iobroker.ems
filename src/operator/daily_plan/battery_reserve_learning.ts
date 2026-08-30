/**
 * BLOCK B — Battery Learned Opportunity (Reserve-Zuverlässigkeit).
 *
 * Nutzt die tatsächliche Block-A-Metrik `batteryReserveAccuracyPct`
 * (`learning/daily_evaluator/learning_state_v1.json` — Anteil bisheriger Reserve-Checks,
 * bei denen die dynamische Reserve tatsächlich gehalten wurde) über das zentrale Learning
 * Gate, um den Netzausgleichs-Opportunity-Gate in `battery_discharge_authority.ts`
 * AUSSCHLIESSLICH restriktiver zu machen — nie lockernder. War die Reserve historisch
 * unzuverlässig (niedriger Score), verlangt der Planner eine größere Preis-Marge über der
 * Opportunity-Cost, bevor er Netzausgleich aus der Batterie erlaubt. War sie zuverlässig
 * (hoher Score) oder ist kein belastbares Learning vorhanden, bleibt die bestehende feste
 * Marge unverändert (Fallback = exakt bisheriges Verhalten).
 *
 * Berührt nie SOC-/Reserve-/Hold-/Safety-Gates selbst — nur die zusätzliche
 * Opportunity-Margen-Schwelle, die ohnehin schon additiv/optional ist.
 */

import { clampToBounds, evaluateLearningGate, type LearningGateReasonCode } from "./unified/learning_gate";
import type { PlannerLearningExplanation } from "./unified/learning_explanation";
import type { BlockALearningMetricSnapshot } from "./block_a_learning_bridge";

export const BATTERY_LEARNING_MIN_SAMPLE_COUNT = 10;
export const BATTERY_LEARNING_MIN_CONFIDENCE_PCT = 50;
/** Ab diesem (gelernten) Reserve-Trefferanteil gilt die Reserve als voll verlässlich → keine Zusatzmarge. */
export const BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT = 90;
/** Harte Obergrenze der zusätzlichen, ausschließlich einschränkenden Marge (ct/kWh). */
export const BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH = 5;

export type BatteryLearningGateReason =
	| LearningGateReasonCode
	| "battery_learning_metric_missing"
	| "battery_learning_value_invalid";

export type BatteryReserveLearningCalibration = {
	usable: boolean;
	gateReason: BatteryLearningGateReason | null;
	value: number | null;
	sampleCount: number | null;
	confidencePct: number | null;
	/**
	 * Zusätzliche Marge (ct/kWh) über der bestehenden Basis-Marge — IMMER >= 0, nie negativ.
	 * 0, wenn nicht usable oder Reserve historisch zuverlässig (>= FULL_TRUST) gehalten wurde.
	 */
	extraMarginCtPerKwh: number;
};

function isValidPct(n: number | null): boolean {
	return n == null || (Number.isFinite(n) && n >= 0 && n <= 100);
}

function unusable(
	gateReason: BatteryLearningGateReason | null,
	metric?: BlockALearningMetricSnapshot | null,
): BatteryReserveLearningCalibration {
	return {
		usable: false,
		gateReason,
		value: metric?.value ?? null,
		sampleCount: metric?.sampleCount ?? null,
		confidencePct: metric?.confidencePct ?? null,
		extraMarginCtPerKwh: 0,
	};
}

/**
 * Kalibriert die zusätzliche Opportunity-Margen-Schwelle anhand von
 * `batteryReserveAccuracyPct`. Läuft immer durch das zentrale Learning Gate — nicht usable
 * (fehlend/zu wenig Samples/zu wenig Confidence/ungültiger Wert) → `extraMarginCtPerKwh = 0`
 * (exakt bisheriges Verhalten, reine Basis-Marge bleibt maßgeblich).
 */
export function calibrateBatteryOpportunityMargin(
	metric: BlockALearningMetricSnapshot | null | undefined,
): BatteryReserveLearningCalibration {
	if (!metric) return unusable("battery_learning_metric_missing", null);
	const { value, sampleCount, confidencePct } = metric;
	if (
		value == null ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 100 ||
		!isValidPct(confidencePct) ||
		(sampleCount != null && (!Number.isFinite(sampleCount) || sampleCount < 0))
	) {
		return unusable("battery_learning_value_invalid", metric);
	}

	const gate = evaluateLearningGate(
		{ sampleCount, confidencePct },
		{ minSampleCount: BATTERY_LEARNING_MIN_SAMPLE_COUNT, minConfidencePct: BATTERY_LEARNING_MIN_CONFIDENCE_PCT },
	);
	if (!gate.usable) return unusable(gate.reasonCode, metric);

	const deficit = Math.max(0, BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT - value);
	const extraMarginCtPerKwh = clampToBounds(
		(deficit / BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT) * BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH,
		0,
		BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH,
	);
	return { usable: true, gateReason: null, value, sampleCount, confidencePct, extraMarginCtPerKwh };
}

/**
 * Baut die gemeinsame Explainability-Struktur aus der Kalibrierung + den tatsächlichen
 * Baseline-/Adjusted-Entscheidungen (beide vom Aufrufer 1:1 aus dem echten Decision-Pfad
 * übernommen — siehe tick.ts, zweifacher Aufruf von `resolveBatteryDischargeAuthorization`
 * mit/ohne Zusatzmarge). `changedByLearning` ist nur true, wenn usable UND die reale
 * Freigabe dadurch tatsächlich abweicht.
 */
export function toBatteryReserveLearningExplanation(
	calibration: BatteryReserveLearningCalibration,
	baselineOpportunityAllowed: boolean,
	adjustedOpportunityAllowed: boolean,
): PlannerLearningExplanation<boolean> {
	return {
		baselineDecision: baselineOpportunityAllowed,
		adjustedDecision: adjustedOpportunityAllowed,
		changedByLearning: calibration.usable && baselineOpportunityAllowed !== adjustedOpportunityAllowed,
		reasonCodes: calibration.usable && calibration.extraMarginCtPerKwh > 0 ? ["battery_reserve_learning_margin_increased"] : [],
		confidencePct: calibration.confidencePct,
		learningMetrics: [
			{
				name: "batteryReserveAccuracyPct",
				value: calibration.value,
				sampleCount: calibration.sampleCount,
				confidencePct: calibration.confidencePct,
				usable: calibration.usable,
				gateReason: calibration.gateReason,
			},
		],
	};
}

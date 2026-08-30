/**
 * BLOCK B — zentrale Learning-Gate-Logik.
 *
 * Jede Block-B-Erweiterung, die ein gelerntes/prognostiziertes Signal (Confidence,
 * Sample-Count) in eine Planner-Entscheidung einfließen lassen will, geht durch dieses
 * Gate. Erfüllt es die Schwellen nicht, gilt exakt das bisherige Planner-Verhalten
 * (Fallback) — es wird nie mit einem unbelastbaren Wert weitergerechnet oder geraten.
 *
 * Bewusst klein und generisch: KEIN Speicher, KEINE Selbstmodifikation, KEINE eigene
 * Lernlogik — nur die Schwellenprüfung. Die eigentlichen Werte (Confidence, Sample-Count)
 * kommen unverändert aus bestehenden Learning-/Forecast-Modulen (z. B. `pv.uncertainty.
 * confidencePct`, `learning/battery_runtime`).
 */

export type LearningGateInput = {
	/** Anzahl belastbarer Stichproben hinter dem Signal; null = unbekannt/nicht anwendbar. */
	sampleCount: number | null;
	/** 0..100 — Confidence des Signals; null = unbekannt. */
	confidencePct: number | null;
};

export type LearningGateConfig = {
	minSampleCount: number;
	minConfidencePct: number;
};

export type LearningGateReasonCode =
	| "learning_gate_signal_unknown"
	| "learning_gate_sample_count_low"
	| "learning_gate_confidence_low";

export type LearningGateResult =
	| { usable: true }
	| { usable: false; reasonCode: LearningGateReasonCode };

/**
 * Prüft ein einzelnes gelerntes/prognostiziertes Signal gegen Mindest-Sample-Count und
 * Mindest-Confidence. `sampleCount: null` gilt als "nicht anwendbar für diese Metrik" und
 * wird NICHT als Ablehnungsgrund gewertet (manche Signale haben keinen Sample-Count-Begriff,
 * z. B. reine Forecast-Confidence) — Confidence bleibt in jedem Fall Pflicht.
 */
export function evaluateLearningGate(
	input: LearningGateInput,
	config: LearningGateConfig,
): LearningGateResult {
	if (input.confidencePct == null || !Number.isFinite(input.confidencePct)) {
		return { usable: false, reasonCode: "learning_gate_signal_unknown" };
	}
	if (
		input.sampleCount != null &&
		Number.isFinite(input.sampleCount) &&
		input.sampleCount < config.minSampleCount
	) {
		return { usable: false, reasonCode: "learning_gate_sample_count_low" };
	}
	if (input.confidencePct < config.minConfidencePct) {
		return { usable: false, reasonCode: "learning_gate_confidence_low" };
	}
	return { usable: true };
}

/** Harte Bounds gegen Scheingenauigkeit — jeder Block-B-Wert muss hierdurch. */
export function clampToBounds(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

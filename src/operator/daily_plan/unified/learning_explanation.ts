/**
 * BLOCK B — gemeinsame, kleine Explainability-Struktur für Learned-Planner-Entscheidungen.
 *
 * Bewusst klein (keine große Explainability-Architektur): EIN generischer Rahmen, den jede
 * Block-B-Domain (Thermal, Battery, ...) mit ihrem eigenen `TDecision`-Typ befüllt. Rein
 * diagnostisch — dieser Typ selbst trifft und beeinflusst NIE eine Control-Entscheidung,
 * er beschreibt nur eine bereits getroffene.
 */

export type PlannerLearningMetricExplanation = {
	/** Fachlicher Name der verwendeten Block-A-Metrik, z. B. "thermalPriceTimingScore". */
	name: string;
	value: number | string | boolean | null;
	sampleCount: number | null;
	confidencePct: number | null;
	/** Hat diese konkrete Metrik das zentrale Learning Gate passiert? */
	usable: boolean;
	/** Grund, warum die Metrik NICHT usable war (null wenn usable=true). */
	gateReason: string | null;
};

export type PlannerLearningExplanation<TDecision> = {
	/** Was der Planner ohne den neuen Block-A-Learning-Einfluss entschieden hätte. */
	baselineDecision: TDecision;
	/** Was der Planner tatsächlich entschieden hat (inkl. usable Learning, falls vorhanden). */
	adjustedDecision: TDecision;
	/**
	 * true NUR wenn mindestens eine Metrik usable war UND sich dadurch das reale
	 * Planner-Ergebnis gegenüber `baselineDecision` tatsächlich verändert hat.
	 */
	changedByLearning: boolean;
	reasonCodes: string[];
	/** Confidence der (Haupt-)Metrik, die diese Entscheidung getragen hat; null = keine/unbekannt. */
	confidencePct: number | null;
	learningMetrics: PlannerLearningMetricExplanation[];
};

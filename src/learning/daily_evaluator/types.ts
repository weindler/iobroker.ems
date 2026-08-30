/**
 * BLOCK A — Datenmodelle für Findings, Scores, Evaluation-Record und diagnostisches
 * Learning. Rein additiv, liest ausschließlich day_telemetry (+ bestehendes Learning
 * als Referenz), schreibt nie zurück in day_telemetry oder aktive Learning-Module.
 */

import {
	DAILY_EVALUATOR_MODULE,
	DAILY_EVALUATOR_SCHEMA_VERSION,
	DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA,
} from "./constants";

/** Domänen, für die Findings/Eligibility gebildet werden (Konsumenten-Ebene, nicht 1:1 TELEMETRY_DOMAIN). */
export const EVALUATOR_DOMAIN = {
	BATTERY: "battery",
	THERMAL: "thermal",
	CLIMATE: "climate",
	EV: "ev",
} as const;
export type EvaluatorDomain = (typeof EVALUATOR_DOMAIN)[keyof typeof EVALUATOR_DOMAIN];

/** Zusätzliche Score-Topics ohne eigene Findings-Domäne (rein deskriptiv aus Telemetrie). */
export const SCORE_TOPIC = {
	BATTERY: "battery",
	THERMAL: "thermal",
	CLIMATE: "climate",
	EV: "ev",
	PV: "pv",
	PRICE: "price",
	COMFORT: "comfort",
} as const;
export type ScoreTopic = (typeof SCORE_TOPIC)[keyof typeof SCORE_TOPIC];

export type DomainEligibilityStatus = "evaluable" | "insufficient_data" | "not_applicable";

export type DomainEligibility = {
	domain: EvaluatorDomain;
	status: DomainEligibilityStatus;
	/** % Slots mit Domain-Quality ok/partial von allen Slots (nicht nur beobachtete). */
	coveragePct: number;
	observedOkSlotCount: number;
	missingSlotCount: number;
	naSlotCount: number;
	totalSlotCount: number;
	reasonCode: string;
	reasonDe: string;
};

/**
 * Klassifikation eines Findings. Bewusst kein Battery-„lost_pv_uptake_high_soc“ (Scheingenauigkeit
 * vorerst nicht implementiert) und keine Kausalattribution zwischen gleichzeitigen Ereignissen.
 */
export type FindingClassification =
	| "mandatory"
	| "necessary"
	| "reasonable"
	| "early"
	| "avoidable"
	| "wasteful"
	| "unknown";

export type FindingQuality = {
	/** Bewertung mit dem zum Entscheidungszeitpunkt bekannten Wissen (Snapshot/Forecast). */
	decisionQuality: FindingClassification;
	/** Bewertung im Rückblick mit tatsächlichen Ist-Werten. Kann von decisionQuality abweichen. */
	outcomeQuality: FindingClassification;
};

/**
 * Ein auditierbarer Fund für eine Domäne/einen Zeitraum an einem Tag.
 * measurements/energyImpact/costImpact bleiben null statt erfundener Werte, wenn nicht
 * belastbar ableitbar (insufficientData=true dokumentiert das explizit).
 */
export type EvaluatorFinding = {
	id: string;
	dateKey: string;
	tsStartIso: string;
	tsEndIso: string;
	domain: EvaluatorDomain;
	/** z. B. Segment-/Slot-Bezug — kein Consumer-Registry-Zwang, rein deskriptiv. */
	assetRef: string | null;
	eventType: string;
	quality: FindingQuality;
	/** 0–100, null wenn insufficientData. */
	confidence: number | null;
	/** Snapshot, dessen Wissensstand für decisionQuality verwendet wurde — null wenn keiner auflösbar. */
	snapshotIdRef: string | null;
	measurements: Record<string, number | null>;
	energyImpactKwh: number | null;
	costImpactCt: number | null;
	reasonCodes: string[];
	explanationDe: string;
	insufficientData: boolean;
	notApplicable: boolean;
	userOverride: boolean;
};

export type DomainScore = {
	topic: ScoreTopic;
	/** null = nicht berechenbar (insufficient_data/not_applicable) — nie erfundene 0/100. */
	value: number | null;
	sampleCount: number;
	basis: string;
};

export type EvaluationRecord = {
	/** Version dieser Evaluator-Logik — für Nachvollziehbarkeit bei Änderungen. */
	evaluatorSchemaVersion: typeof DAILY_EVALUATOR_SCHEMA_VERSION;
	/** Schema-Version der day_telemetry-Quelle, gegen die gerechnet wurde. */
	sourceTelemetrySchemaVersion: number;
	/** updatedAtIso der Quelldatei zum Zeitpunkt der Auswertung. */
	sourceUpdatedAtIso: string;
	dateKey: string;
	timezone: string;
	evaluatedAtIso: string;
	/** Kalendertag abgeschlossen? — reines Metadatum, kein pauschaler Learning-Ausschluss. */
	dayComplete: boolean;
	/** Globale Coverage aus day_telemetry — Metadatum, siehe DomainEligibility für Learning-Gates. */
	dayEvaluable: boolean;
	dayCoveragePct: number;
	eligibility: DomainEligibility[];
	findingsCount: number;
	findingsByDomain: Record<EvaluatorDomain, number>;
	scores: DomainScore[];
	/** Gleichgewichtet über tatsächlich evaluierbare Score-Topics — Gewichte persistiert für Nachvollziehbarkeit. */
	globalScore: number | null;
	globalScoreWeights: Record<string, number>;
};

export type EvaluatorFindingsFile = {
	module: typeof DAILY_EVALUATOR_MODULE;
	schemaVersion: typeof DAILY_EVALUATOR_SCHEMA_VERSION;
	dateKey: string;
	findings: EvaluatorFinding[];
};

export type EvaluatorScoresFile = {
	module: typeof DAILY_EVALUATOR_MODULE;
	schemaVersion: typeof DAILY_EVALUATOR_SCHEMA_VERSION;
	dateKey: string;
	record: EvaluationRecord;
};

/** Ein diagnostischer Learning-Sample-Slot: value/sampleCount/confidence/updatedAt + Streubreite. */
export type LearningMetric = {
	value: number | null;
	sampleCount: number;
	/** 0–100. null wenn sampleCount < Mindestanzahl. */
	confidence: number | null;
	updatedAtIso: string | null;
	periodStartIso: string | null;
	periodEndIso: string | null;
	min: number | null;
	max: number | null;
	variance: number | null;
	reasonDe: string;
};

export function emptyLearningMetric(): LearningMetric {
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

/**
 * Eigener diagnostischer Learning-State (Block A) — schreibt NIE in pv_bias, battery_runtime,
 * thermal_runtime, house_load etc. Domain-basiert: ein global insufficient Tag kann trotzdem
 * einzelne Metriken befüllen, wenn genau diese Domäne an dem Tag evaluable war.
 */
export type DailyEvaluatorLearningState = {
	module: typeof DAILY_EVALUATOR_MODULE;
	schemaVersion: typeof DAILY_EVALUATOR_SCHEMA_VERSION;
	updatedAtIso: string;
	batteryReserveAccuracyPct: LearningMetric;
	thermalPriceTimingScore: LearningMetric;
	climatePriceTimingScore: LearningMetric;
	evReadinessMetRatePct: LearningMetric;
	pvUtilizationPct: LearningMetric;
	priceEfficiencyScore: LearningMetric;
	/** Zuletzt verarbeitete dateKey — für idempotente Batch-Verarbeitung. */
	lastProcessedDateKey: string | null;
};

export function emptyDailyEvaluatorLearningState(): DailyEvaluatorLearningState {
	return {
		module: DAILY_EVALUATOR_MODULE,
		schemaVersion: DAILY_EVALUATOR_SCHEMA_VERSION,
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

export { DAILY_EVALUATOR_SCHEMA_VERSION, DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA };

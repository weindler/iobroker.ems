/**
 * Persistierte Tagesbewertung (Schritt 7) — kompakt, keine State-Flut.
 * Unknown bleibt null — keine Fake-0.
 */

export const DAY_EVAL_MODULE = "day_evaluation" as const;
export const DAY_EVAL_SCHEMA = 1 as const;
export const DAY_EVAL_RETENTION_DAYS = 120;
export const DAY_EVAL_PERSIST_FILE = "day_evaluation_v1.json";

export type GoalOutcome = {
	consumerId: string;
	goalId: string;
	status: "reached" | "missed" | "unknown";
	reasonCodes: string[];
};

export type DayEvalPlanMeta = {
	date: string;
	timezone: string;
	initialPlanId: string | null;
	finalPlanId: string | null;
	initialGeneration: number | null;
	finalGeneration: number | null;
	replanCount: number;
	replanReasons: string[];
	inputRevision: number | null;
	plannerConfidencePct: number | null;
	plannerDegraded: boolean;
};

export type DayEvalPv = {
	initialExpectedKwh: number | null;
	finalExpectedKwh: number | null;
	actualKwh: number | null;
	absoluteErrorKwh: number | null;
	percentageErrorPct: number | null;
};

export type DayEvalHouseLoad = {
	expectedKwh: number | null;
	actualKwh: number | null;
	deviationKwh: number | null;
};

export type DayEvalGrid = {
	expectedImportKwh: number | null;
	actualImportKwh: number | null;
	expectedExportKwh: number | null;
	actualExportKwh: number | null;
	expectedCostCt: number | null;
	actualCostCt: number | null;
};

export type DayEvalBattery = {
	startSocPct: number | null;
	plannedEndSocPct: number | null;
	actualEndSocPct: number | null;
	plannedChargedKwh: number | null;
	actualChargedKwh: number | null;
};

export type DayEvalImmersion = {
	plannedKwh: number | null;
	actualKwh: number | null;
	plannedTargetTempC: number | null;
	targetReached: boolean | null;
};

export type DayEvalClimate = {
	plannedKwh: number | null;
	actualKwh: number | null;
	comfortViolations: number | null;
};

export type DayEvalVehicle = {
	plannedPvChargeKwh: number | null;
	plannedGridChargeKwh: number | null;
	actualChargeKwh: number | null;
	targetSocPct: number | null;
	requiredEnergyKwh: number | null;
	targetReached: boolean | null;
	plannedGridCostCt: number | null;
	actualGridCostCt: number | null;
	savingsVsEarliestFeasibleCt: number | null;
	economicsCompleteness: "full" | "grid_only" | "unknown" | null;
};

export type DayEvaluationRecord = {
	schemaVersion: typeof DAY_EVAL_SCHEMA;
	evaluatedAtIso: string;
	plan: DayEvalPlanMeta;
	pv: DayEvalPv;
	houseLoad: DayEvalHouseLoad;
	grid: DayEvalGrid;
	battery: DayEvalBattery;
	immersion: DayEvalImmersion;
	climate: DayEvalClimate;
	vehicle: DayEvalVehicle;
	goals: GoalOutcome[];
	/** Ob Learning-Feedback für diesen Tag bereits angewendet wurde. */
	learningApplied: boolean;
};

export type DayEvaluationStore = {
	module: typeof DAY_EVAL_MODULE;
	schemaVersion: typeof DAY_EVAL_SCHEMA;
	updatedAtIso: string;
	/** date → evaluation (höchstens eine pro lokalem Tag). */
	days: Record<string, DayEvaluationRecord>;
};

export function emptyDayEvaluationStore(): DayEvaluationStore {
	return {
		module: DAY_EVAL_MODULE,
		schemaVersion: DAY_EVAL_SCHEMA,
		updatedAtIso: new Date(0).toISOString(),
		days: {},
	};
}

export function absError(expected: number | null, actual: number | null): number | null {
	if (expected === null || actual === null) return null;
	if (!Number.isFinite(expected) || !Number.isFinite(actual)) return null;
	return Math.round(Math.abs(actual - expected) * 1000) / 1000;
}

export function pctError(expected: number | null, actual: number | null): number | null {
	if (expected === null || actual === null || !Number.isFinite(expected) || expected === 0) return null;
	if (!Number.isFinite(actual)) return null;
	return Math.round(((actual - expected) / expected) * 1000) / 10;
}

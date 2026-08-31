/**
 * BLOCK A — Daily Evaluator + Decision Scores + Learning Engine.
 * Eigenständiges, additives Modul. Liest day_telemetry als Quelle, schreibt NIE
 * in day_telemetry oder in aktive Learning-Module (pv_bias, battery_runtime, ...).
 */

export const DAILY_EVALUATOR_MODULE = "daily_evaluator" as const;

/** Version der Evaluator-Logik selbst — nicht des Telemetrie-Schemas. */
export const DAILY_EVALUATOR_SCHEMA_VERSION = 1 as const;

/** Muss mit DAY_TELEMETRY_SCHEMA aus learning/day_telemetry/constants.ts übereinstimmen (Referenz, kein Import-Zwang). */
export const DAILY_EVALUATOR_EXPECTED_TELEMETRY_SCHEMA = 2 as const;

export const DAILY_EVALUATOR_FINDINGS_CATEGORY = "learning/daily_evaluator/findings";
export const DAILY_EVALUATOR_SCORES_CATEGORY = "learning/daily_evaluator/scores";
export const DAILY_EVALUATOR_STATE_CATEGORY = "learning/daily_evaluator";
export const DAILY_EVALUATOR_LEARNING_STATE_FILE = "learning_state_v1.json";

/** Gleiche Retention wie day_telemetry — Findings/Scores können nicht älter als die Quelle sein. */
export const DAILY_EVALUATOR_RETENTION_DAYS = 90;

/**
 * Ab diesem Domain-Coverage-Anteil (%) gilt eine Domäne für den Tag als evaluable.
 * Bewusst == DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT (gleiche Güte-Schwelle), aber
 * pro Domäne statt global — ein global nicht evaluabler Tag kann trotzdem einzelne
 * vollständig evaluierbare Domänen liefern.
 */
export const DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT = 80;

/**
 * Anteil na-Slots (von allen Slots, nicht nur beobachteten), ab dem eine Domäne als
 * not_applicable statt insufficient_data gilt (z. B. kein Klima/EV konfiguriert/verbunden).
 */
export const DAILY_EVALUATOR_NOT_APPLICABLE_NA_SHARE = 0.95;

export const DAILY_EVALUATOR_STATES = {
	status: "learning.daily_evaluator.status",
	lastEvaluatedDateKey: "learning.daily_evaluator.last_evaluated_date_key",
	lastRunAtIso: "learning.daily_evaluator.last_run_at_iso",
	lastError: "learning.daily_evaluator.last_error",
	pendingBacklogCount: "learning.daily_evaluator.pending_backlog_count",
	lastDayEvaluable: "learning.daily_evaluator.last_day_evaluable",
	lastDayGlobalScore: "learning.daily_evaluator.last_day_global_score",
	lastDayFindingsCount: "learning.daily_evaluator.last_day_findings_count",
	lastDayTopFindingDe: "learning.daily_evaluator.last_day_top_finding_de",
	learningSampleCountJson: "learning.daily_evaluator.learning_sample_count_json",
} as const;

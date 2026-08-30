export {
	DAILY_EVALUATOR_MODULE,
	DAILY_EVALUATOR_SCHEMA_VERSION,
	DAILY_EVALUATOR_FINDINGS_CATEGORY,
	DAILY_EVALUATOR_SCORES_CATEGORY,
	DAILY_EVALUATOR_STATE_CATEGORY,
	DAILY_EVALUATOR_LEARNING_STATE_FILE,
	DAILY_EVALUATOR_RETENTION_DAYS,
	DAILY_EVALUATOR_DOMAIN_COVERAGE_PCT,
	DAILY_EVALUATOR_STATES,
} from "./constants";

export {
	EVALUATOR_DOMAIN,
	SCORE_TOPIC,
	emptyLearningMetric,
	emptyDailyEvaluatorLearningState,
} from "./types";
export type {
	EvaluatorDomain,
	ScoreTopic,
	DomainEligibilityStatus,
	DomainEligibility,
	FindingClassification,
	FindingQuality,
	EvaluatorFinding,
	DomainScore,
	EvaluationRecord,
	LearningMetric,
	DailyEvaluatorLearningState,
} from "./types";

export { evaluateDomainEligibility, evaluateAllDomainEligibility } from "./eligibility";
export {
	resolveKnowledgeSnapshotAt,
	resolveKnownPriceAtSlotStart,
	priceRankPercentileAtDecisionTime,
} from "./knowledge_time";
export { evaluateBatteryFindings } from "./battery_findings";
export { evaluateThermalFindings } from "./thermal_findings";
export { evaluateClimateFindings } from "./climate_findings";
export { evaluateEvFindings } from "./ev_findings";
export { computeDomainScores, computeGlobalScore } from "./scores";
export { evaluateDay } from "./evaluate";
export { applyDayToLearningState } from "./learning";
export { confidenceFromSampleCount, updateLearningMetric } from "./learning_math";
export {
	writeFindingsDay,
	readFindingsDay,
	writeScoresDay,
	readScoresDay,
	pruneDailyEvaluatorFiles,
	listEvaluatedDateKeys,
	loadDailyEvaluatorLearningState,
	writeDailyEvaluatorLearningState,
	learningStatePath,
} from "./persist";
export { runDailyEvaluatorBatch, readDailyEvaluatorScores, type DailyEvaluatorHost, type DailyEvaluatorBatchResult } from "./run";
export { ensureDailyEvaluatorStates, DAILY_EVALUATOR_STATE_IDS } from "./ensure_states";

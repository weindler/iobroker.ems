export type {
	PlannerShadowComparisonResult,
	PlannerShadowComparisonStatus,
	PlannerShadowGridProjection,
	PlannerShadowGridSlotProjection,
	PlannerShadowReferenceMeta,
} from "./types";
export { computeShadowProjectionRevision, canonicalShadowProjectionJson, shortenRevision } from "./canonical";
export {
	projectionFromGridSupplyForecast,
	projectionFromPreparedInput,
	projectionFromSnapshot,
} from "./projection";
export {
	compareAgainstStoredReference,
	compareShadowProjections,
	compareSnapshotPreparedInput,
} from "./compare";
export type { PlannerShadowDetailedMismatch } from "./compare";
export {
	recordGridSupplyShadowReference,
	getGridSupplyShadowReference,
	clearGridSupplyShadowReferenceForTest,
} from "./reference_store";
export {
	PLANNER_COORDINATOR_STATE_IDS,
	PLANNER_COORDINATOR_STATE_PREFIX,
	ensurePlannerCoordinatorStates,
	isPlannerCoordinatorState,
} from "./ensure_states";
export { writePlannerCoordinatorStatusStates } from "./status_bridge";
export {
	initPlannerShadowRuntime,
	stopPlannerShadowRuntime,
	handlePlannerShadowStateChange,
	observePlannerTriggerStateChange,
	isPlannerShadowEnabledForTest,
	getPlannerConfiguredModeForTest,
	getPlannerEffectiveModeForTest,
} from "./runtime";
export type { PlannerShadowRuntimeHost } from "./runtime";
export { resolveEffectivePlannerMode, initialSessionShadowFromNative } from "./mode";
export { comparePlanCandidates } from "./candidate_compare";
export type { PlannerCandidateComparisonResult, PlannerCandidateComparisonStatus } from "./candidate_compare";

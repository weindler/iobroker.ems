/**
 * Unified Day Planner — Contract (Schritt 1) + Allocation Core (Schritt 2).
 * IH/AC: Dispatch nur über planner.intent.allocation.* → bestehende Runtimes.
 * Battery/Wallbox: kein Unified-Live-Takeover in dieser Beta-Stufe.
 */

export * from "./types";
export * from "./evaluate";
export * from "./reason_codes";
export { allocateUnifiedDayPlan } from "./allocate";
export {
	applyUnifiedIhAcAuthority,
	clearIhAcAuthority,
	isIhAcContributionId,
} from "./authority";
export {
	buildUnifiedInputFromForecastContext,
	summarizeUnifiedDayPlanForReason,
} from "./from_forecast_context";
export { unifiedPlanCadenceDigest } from "./cadence";
export {
	evaluateMaterialReplan,
	pvRevisionContext,
	REPLAN_COOLDOWN_MS,
	MATERIAL_HOUSE_LOAD_KWH,
	MATERIAL_BATTERY_SOC_PP,
	MATERIAL_THERMAL_HEADROOM_KWH,
	type PlanBaseline,
	type PlanActualSample,
	type MaterialReplanDecision,
} from "./materiality";
export {
	assessUnifiedReplanFailure,
	applyReplanFailureAuthority,
	immersionRestStillSafe,
	climatePlanDispatchStillSafe,
} from "./replan_failure";
export { buildDayEvaluationDraft, type UnifiedDayEvaluation } from "./day_evaluation";
export {
	trimUnifiedInputToRemainingHorizon,
	type AllocateUnifiedOptions,
} from "./allocate";
export {
	buildUnifiedIhAcDispatchPublish,
	unifiedPlanToImmersionAllocations,
	unifiedPlanToClimateAllocations,
} from "./dispatch_bridge";
export { publishUnifiedIhAcDispatch } from "./publish_ih_ac";
export {
	buildSlots,
	golden001Input,
	golden001BadPlan,
	golden001GoodPlan,
	golden001ScaledInput,
	golden001ScaledBadPlan,
	golden002Input,
	golden002BadPlanAbsentCharge,
	golden002GoodPlan,
	golden003Input,
	golden003BadEarlyGrid,
	golden003GoodPv,
	golden004Input,
	golden004ReplanPlan,
	golden004StalePlanNoReplan,
	golden005Input,
	golden005BadNightBatteryHeat,
	golden005GoodDayPvHeat,
} from "./fixtures";

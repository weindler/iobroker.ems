/**
 * Unified Day Planner — Contract + Allocation + Live Authority (Schritt 1–6).
 * IH/AC/Battery/Wallbox: Dispatch nur über planner.intent.allocation.* → bestehende Runtimes.
 * Planner schreibt keine Geräte-States.
 */

export * from "./types";
export * from "./evaluate";
export * from "./reason_codes";
export { allocateUnifiedDayPlan } from "./allocate";
export {
	applyUnifiedDayAuthority,
	applyUnifiedIhAcAuthority,
	clearIhAcAuthority,
	clearAllUnifiedAuthority,
	isIhAcContributionId,
	isBatteryContributionId,
	isWallboxContributionId,
	isUnifiedManagedContributionId,
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
	batteryRestStillSafe,
	wallboxRestStillSafe,
} from "./replan_failure";
export {
	buildVehicleAvailabilityWindows,
	evaluateVehicleGoalFeasibility,
	vehicleSlotAllocatable,
	presenceDigest,
	normalizePresenceWindow,
} from "./vehicle_availability";
export { buildDayEvaluationDraft, type UnifiedDayEvaluation } from "./day_evaluation";
export {
	trimUnifiedInputToRemainingHorizon,
	type AllocateUnifiedOptions,
} from "./allocate";
export {
	buildUnifiedIhAcDispatchPublish,
	buildUnifiedDispatchPublish,
	unifiedPlanToImmersionAllocations,
	unifiedPlanToClimateAllocations,
	unifiedPlanToBatteryAllocations,
	unifiedPlanToWallboxAllocations,
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

export { buildProductSummaryDe, buildUnifiedDayAgendaDe } from "./product_summary";
export type { AgendaExecutionContext, AgendaExecutionAddon } from "./product_summary";
export { buildProductNotificationSurface } from "./notification_surface";
export type { ProductNotificationSurface } from "./notification_surface";
export { buildEffectiveExecutionSnapshot } from "./execution_effective";
export type { EffectiveExecutionSnapshot } from "./execution_effective";
export {
	addonOffSummaryDe,
	agendaStatusLabelDe,
	buildAgendaExecutionHints,
	classifyClimateDemand,
	executionAuthorityBadge,
	executionDisplayBadge,
	formatAgendaSlotMetaDe,
	formatExecutionNowLineDe,
	isEffectiveLiveWriteAllowed,
	isImmersionHardwareActive,
	operationFromBatteryStrategy,
	operationFromWallboxStrategy,
	resolveClimateUnitDisplay,
	resolveExecutionAuthority,
	resolveExecutionAuthorityFromModes,
	resolveExecutionDisplayPhase,
} from "./execution_display";
export type {
	ClimateDemandKind,
	ClimateUnitDisplay,
	ExecutionAuthority,
	ExecutionAuthorityBadge,
	ExecutionDisplayPhase,
	ExecutionDisplayBadge,
	OperationDisplay,
	OperationDisplayKind,
} from "./execution_display";
export {
	buildAddonStrategicPlanSnapshot,
	deriveBatteryStrategicStatus,
	deriveWallboxStrategicStatus,
} from "./strategic_status";
export type {
	AddonStrategicPlanSnapshot,
	BatteryStrategicSnapshot,
	BatteryStrategicStatus,
	WallboxStrategicSnapshot,
	WallboxStrategicStatus,
} from "./strategic_status";
export {
	agendaBucketForWindow,
	mergeWindows,
	selectRelevantAgendaWindows,
} from "./product_summary";
export {
	chartStartsAbsentFromPlan,
	climatePlanLineFromWindowsDe,
	climateHeuteLineFromPlanDe,
	climateUnitTimelineWindowsFromPlanJson,
	collectPlanVisSlots,
	collapsePlanVisWindows,
	firstOpenPlanVisWindow,
	immersionTimelineWindowsFromPlanJson,
	isOutsideClockWindowReason,
	nextPlanVisWindow,
} from "./plan_visibility";
export type { PlanVisSlot, PlanVisWindow } from "./plan_visibility";
export { BETA_SURFACE_CLASSES, countBySurfaceClass } from "./surface_classes";
export type { SurfaceClass, SurfaceClassEntry } from "./surface_classes";

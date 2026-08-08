export { buildProductSummaryDe, buildUnifiedDayAgendaDe } from "./product_summary";
export type { AgendaExecutionContext, AgendaExecutionAddon } from "./product_summary";
export { buildProductNotificationSurface } from "./notification_surface";
export type { ProductNotificationSurface } from "./notification_surface";
export { buildEffectiveExecutionSnapshot } from "./execution_effective";
export type { EffectiveExecutionSnapshot } from "./execution_effective";
export {
	agendaStatusLabelDe,
	buildAgendaExecutionHints,
	classifyClimateDemand,
	executionDisplayBadge,
	formatAgendaSlotMetaDe,
	formatExecutionNowLineDe,
	isEffectiveLiveWriteAllowed,
	isImmersionHardwareActive,
	resolveClimateUnitDisplay,
	resolveExecutionDisplayPhase,
} from "./execution_display";
export type {
	ClimateDemandKind,
	ClimateUnitDisplay,
	ExecutionDisplayPhase,
	ExecutionDisplayBadge,
} from "./execution_display";
export { BETA_SURFACE_CLASSES, countBySurfaceClass } from "./surface_classes";
export type { SurfaceClass, SurfaceClassEntry } from "./surface_classes";

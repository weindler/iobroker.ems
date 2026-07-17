export const PLANNER_TRIGGER_CLASSES = [
	"configuration",
	"mapping",
	"forecast",
	"price",
	"telemetry",
	"constraint",
	"learning",
	"schedule",
	"startup",
	"manual",
	"manual_force",
] as const;

export type PlannerTriggerClass = (typeof PLANNER_TRIGGER_CLASSES)[number];

/** Compact, stable, machine-readable reason codes. */
export const PLANNER_TRIGGER_REASON_CODES = [
	"manual",
	"manual_force",
	"startup",
	"schedule_slot",
	"schedule_day",
	"schedule_renewal",
	"config_change",
	"mapping_change",
	"forecast_change",
	"price_change",
	"telemetry_change",
	"constraint_change",
	"learning_change",
	"relevant_change",
] as const;

export type PlannerTriggerReasonCode = (typeof PLANNER_TRIGGER_REASON_CODES)[number];

export interface PlannerTriggerEvent {
	class: PlannerTriggerClass;
	reasonCode: PlannerTriggerReasonCode;
	sourceId: string;
	observedAt: string;
	force?: boolean;
}

export function isPlannerTriggerClass(value: unknown): value is PlannerTriggerClass {
	return typeof value === "string" && (PLANNER_TRIGGER_CLASSES as readonly string[]).includes(value);
}

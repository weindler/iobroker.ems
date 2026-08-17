import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
	};
}

export const FORECAST_PLAN_STATE_IDS = {
	status: "planner.intent.forecast_plan.status",
	generatedAt: "planner.intent.forecast_plan.generated_at",
	validUntil: "planner.intent.forecast_plan.valid_until",
	horizonStart: "planner.intent.forecast_plan.horizon_start",
	horizonEnd: "planner.intent.forecast_plan.horizon_end",
	slotMinutes: "planner.intent.forecast_plan.slot_minutes",
	activeContributorsJson: "planner.intent.forecast_plan.active_contributors_json",
	excludedContributorsJson: "planner.intent.forecast_plan.excluded_contributors_json",
	daysJson: "planner.intent.forecast_plan.days_json",
	slotsJson: "planner.intent.forecast_plan.slots_json",
	contributionsJson: "planner.intent.forecast_plan.contributions_json",
	planJson: "planner.intent.forecast_plan.plan_json",
	reasonDe: "planner.intent.forecast_plan.reason_de",
	revision: "planner.intent.forecast_plan.revision",
} as const;

export async function ensureForecastPlanStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.intent.forecast_plan", "Planner Forecast Plan");

	const defs: StateDef[] = [
		strState(FORECAST_PLAN_STATE_IDS.status, "Forecast Plan Status", "not_initialized"),
		strState(FORECAST_PLAN_STATE_IDS.generatedAt, "Forecast Plan erzeugt (ISO)"),
		strState(FORECAST_PLAN_STATE_IDS.validUntil, "Forecast Plan gültig bis (ISO)"),
		strState(FORECAST_PLAN_STATE_IDS.reasonDe, "Forecast Plan Begründung (DE)", ""),
		numState(FORECAST_PLAN_STATE_IDS.revision, "Forecast Plan Revision", 0),
	];

	await ensureStates(host, defs);
}

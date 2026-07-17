/** Native takeover evaluation mode — durable across restarts. Default: disabled. */

export const PLANNER_TAKEOVER_EVALUATION_MODES = ["disabled", "observe"] as const;

export type PlannerTakeoverEvaluationMode = (typeof PLANNER_TAKEOVER_EVALUATION_MODES)[number];

/** Admin / native config key (jsonConfig). */
export const PLANNER_TAKEOVER_EVALUATION_MODE_CONFIG_KEY = "planner_takeover_evaluation_mode";

export const PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT: PlannerTakeoverEvaluationMode = "disabled";

export function isPlannerTakeoverEvaluationMode(value: unknown): value is PlannerTakeoverEvaluationMode {
	return (
		typeof value === "string" &&
		(PLANNER_TAKEOVER_EVALUATION_MODES as readonly string[]).includes(value)
	);
}

/**
 * Clamp invalid / missing values to `disabled`.
 */
export function parsePlannerTakeoverEvaluationMode(raw: unknown): {
	mode: PlannerTakeoverEvaluationMode;
	clamped: boolean;
} {
	if (raw === undefined || raw === null || raw === "") {
		return { mode: PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, clamped: false };
	}
	if (isPlannerTakeoverEvaluationMode(raw)) {
		return { mode: raw, clamped: false };
	}
	return { mode: PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, clamped: true };
}

export function plannerTakeoverEvaluationModeFromConfig(config: unknown): {
	mode: PlannerTakeoverEvaluationMode;
	clamped: boolean;
	raw: unknown;
} {
	const raw =
		config && typeof config === "object"
			? (config as Record<string, unknown>)[PLANNER_TAKEOVER_EVALUATION_MODE_CONFIG_KEY]
			: undefined;
	const parsed = parsePlannerTakeoverEvaluationMode(raw);
	return { ...parsed, raw };
}

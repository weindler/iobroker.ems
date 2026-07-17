/** Native planner runtime mode — durable across adapter restarts. Default: off. */

export const PLANNER_RUNTIME_MODES = ["off", "shadow_manual", "shadow_auto"] as const;

export type PlannerRuntimeMode = (typeof PLANNER_RUNTIME_MODES)[number];

/** Admin / native config key (jsonConfig). */
export const PLANNER_RUNTIME_MODE_CONFIG_KEY = "planner_runtime_mode";

export const PLANNER_RUNTIME_MODE_DEFAULT: PlannerRuntimeMode = "off";

export function isPlannerRuntimeMode(value: unknown): value is PlannerRuntimeMode {
	return typeof value === "string" && (PLANNER_RUNTIME_MODES as readonly string[]).includes(value);
}

/**
 * Clamp invalid / missing values to `off`.
 * Returns `{ mode, clamped }` where `clamped` is true when the raw value was invalid.
 */
export function parsePlannerRuntimeMode(raw: unknown): { mode: PlannerRuntimeMode; clamped: boolean } {
	if (raw === undefined || raw === null || raw === "") {
		return { mode: PLANNER_RUNTIME_MODE_DEFAULT, clamped: false };
	}
	if (isPlannerRuntimeMode(raw)) {
		return { mode: raw, clamped: false };
	}
	return { mode: PLANNER_RUNTIME_MODE_DEFAULT, clamped: true };
}

export function plannerRuntimeModeFromConfig(config: unknown): {
	mode: PlannerRuntimeMode;
	clamped: boolean;
	raw: unknown;
} {
	const raw =
		config && typeof config === "object"
			? (config as Record<string, unknown>)[PLANNER_RUNTIME_MODE_CONFIG_KEY]
			: undefined;
	const parsed = parsePlannerRuntimeMode(raw);
	return { ...parsed, raw };
}

export function plannerRuntimeModeAllowsManual(mode: PlannerRuntimeMode): boolean {
	return mode === "shadow_manual" || mode === "shadow_auto";
}

export function plannerRuntimeModeAllowsAuto(mode: PlannerRuntimeMode): boolean {
	return mode === "shadow_auto";
}

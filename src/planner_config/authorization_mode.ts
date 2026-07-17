/** Native takeover authorization mode — durable across restarts. Default: disabled. */

export const PLANNER_TAKEOVER_AUTHORIZATION_MODES = ["disabled", "manual_prepare"] as const;

export type PlannerTakeoverAuthorizationMode = (typeof PLANNER_TAKEOVER_AUTHORIZATION_MODES)[number];

export const PLANNER_TAKEOVER_AUTHORIZATION_MODE_CONFIG_KEY = "planner_takeover_authorization_mode";

export const PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT: PlannerTakeoverAuthorizationMode = "disabled";

export function isPlannerTakeoverAuthorizationMode(value: unknown): value is PlannerTakeoverAuthorizationMode {
	return (
		typeof value === "string" &&
		(PLANNER_TAKEOVER_AUTHORIZATION_MODES as readonly string[]).includes(value)
	);
}

export function parsePlannerTakeoverAuthorizationMode(raw: unknown): {
	mode: PlannerTakeoverAuthorizationMode;
	clamped: boolean;
} {
	if (raw === undefined || raw === null || raw === "") {
		return { mode: PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, clamped: false };
	}
	if (isPlannerTakeoverAuthorizationMode(raw)) {
		return { mode: raw, clamped: false };
	}
	return { mode: PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, clamped: true };
}

export function plannerTakeoverAuthorizationModeFromConfig(config: unknown): {
	mode: PlannerTakeoverAuthorizationMode;
	clamped: boolean;
	raw: unknown;
} {
	const raw =
		config && typeof config === "object"
			? (config as Record<string, unknown>)[PLANNER_TAKEOVER_AUTHORIZATION_MODE_CONFIG_KEY]
			: undefined;
	const parsed = parsePlannerTakeoverAuthorizationMode(raw);
	return { ...parsed, raw };
}

/** Native requested planner authority source — durable across restarts. Default: legacy. */

export const PLANNER_REQUESTED_AUTHORITIES = ["legacy", "worker_dryrun"] as const;

export type PlannerRequestedAuthority = (typeof PLANNER_REQUESTED_AUTHORITIES)[number];

export const PLANNER_AUTHORITATIVE_SOURCE_CONFIG_KEY = "planner_authoritative_source";

export const PLANNER_AUTHORITATIVE_SOURCE_DEFAULT: PlannerRequestedAuthority = "legacy";

export function isPlannerRequestedAuthority(value: unknown): value is PlannerRequestedAuthority {
	return (
		typeof value === "string" &&
		(PLANNER_REQUESTED_AUTHORITIES as readonly string[]).includes(value)
	);
}

export function parsePlannerRequestedAuthority(raw: unknown): {
	mode: PlannerRequestedAuthority;
	clamped: boolean;
} {
	if (raw === undefined || raw === null || raw === "") {
		return { mode: PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, clamped: false };
	}
	if (isPlannerRequestedAuthority(raw)) {
		return { mode: raw, clamped: false };
	}
	return { mode: PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, clamped: true };
}

export function plannerRequestedAuthorityFromConfig(config: unknown): {
	mode: PlannerRequestedAuthority;
	clamped: boolean;
	raw: unknown;
} {
	const raw =
		config && typeof config === "object"
			? (config as Record<string, unknown>)[PLANNER_AUTHORITATIVE_SOURCE_CONFIG_KEY]
			: undefined;
	const parsed = parsePlannerRequestedAuthority(raw);
	return { ...parsed, raw };
}

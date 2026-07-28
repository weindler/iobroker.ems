import type { CanonicalDecisionSource } from "./types";

const OFF = new Set([
	"off",
	"addon_disabled",
	"governance_disabled",
	"unit_disabled",
]);

const MANUAL = new Set(["manual", "manual_off", "manual_force", "manual_user_intent"]);

const DETERMINISTIC = new Set([
	"deterministic_planner",
	"daily_plan",
	"daily_plan_zero",
	"daily_plan_passive_pv",
	"surplus_pull_forward",
]);

const AI = new Set(["ai"]);

const POLICY = new Set([
	"policy",
	"vehicle_disconnected",
	"external_plan_only",
	"temperature_no_demand",
	"no_plan",
]);

const POLICY_FALLBACK = new Set([
	"policy_fallback",
	"thermal_fallback",
	"climate_fallback",
	"battery_winter_fallback",
	"legacy_planner_fallback",
	"grid_balance_fallback",
	"invalid_plan",
]);

/**
 * Map addon-specific decision_source detail → Masterplan §10 canonical enum.
 * Unknown values fall back to `safety` (never invent policy/planner).
 */
export function mapDecisionDetailToCanonical(detail: string): CanonicalDecisionSource {
	const key = String(detail || "")
		.trim()
		.toLowerCase();
	if (!key) {
		return "safety";
	}
	if (OFF.has(key)) {
		return "off";
	}
	if (MANUAL.has(key)) {
		return "manual";
	}
	if (DETERMINISTIC.has(key)) {
		return "deterministic_planner";
	}
	if (AI.has(key)) {
		return "ai";
	}
	if (POLICY.has(key)) {
		return "policy";
	}
	if (POLICY_FALLBACK.has(key)) {
		return "policy_fallback";
	}
	// safety, fault, lockout, safe_default, restore, missing_telemetry, mapping_incomplete, cleaning, …
	return "safety";
}

/** Derive planner_status from common daily-plan status strings + flags. */
export function plannerStatusFromDailyPlan(input: {
	governanceEnabled: boolean;
	addonEnabled?: boolean;
	useDailyPlan?: boolean;
	dailyPlanValid?: boolean;
	dailyPlanStatus?: string | null;
}): import("./types").PlannerStatus {
	if (input.addonEnabled === false || input.governanceEnabled === false) {
		return "off";
	}
	if (input.useDailyPlan === true || input.dailyPlanValid === true) {
		return "valid";
	}
	const st = String(input.dailyPlanStatus || "")
		.trim()
		.toLowerCase();
	if (!st || st.includes("missing") || st === "no_plan" || st === "none") {
		return "missing";
	}
	if (st.includes("invalid") || st.includes("stale") || st.includes("error")) {
		return "invalid";
	}
	if (st.includes("valid") || st.includes("ok") || st.includes("active") || st.includes("authoritative")) {
		return "unused";
	}
	return "unused";
}

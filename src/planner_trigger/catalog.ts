import type { PlannerTriggerClass, PlannerTriggerReasonCode } from "./types";

export interface CatalogEntry {
	/** Relative state id or prefix match. */
	id: string;
	match: "exact" | "prefix";
	class: PlannerTriggerClass;
	reasonCode: PlannerTriggerReasonCode;
	/**
	 * Which ack values are accepted.
	 * - any: foreign telemetry often arrives ack=true
	 * - conscious: user/admin writes with ack=false
	 * - ack_true: mirrored/learning updates typically ack=true
	 */
	ackPolicy: "any" | "conscious" | "ack_true";
}

/** Positive list — only these (and prefixes) may auto-trigger. */
export const PLANNER_TRIGGER_ALLOWLIST: readonly CatalogEntry[] = [
	// Live telemetry
	{ id: "live.pv.power_w", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "live.battery.house_load_w", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "live.battery.soc_pct", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "live.thermal.buffer_temp_c", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "live.price.now_ct_per_kwh", match: "exact", class: "price", reasonCode: "price_change", ackPolicy: "any" },
	{ id: "live.grid.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	// Global / policy / config surfaces that feed the snapshot
	{ id: "global_modes.active", match: "exact", class: "configuration", reasonCode: "config_change", ackPolicy: "any" },
	{ id: "global.execution_mode", match: "exact", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
	{ id: "policy.global.", match: "prefix", class: "constraint", reasonCode: "constraint_change", ackPolicy: "any" },
	{ id: "economics.config.", match: "prefix", class: "price", reasonCode: "price_change", ackPolicy: "conscious" },
	// Learning outputs that feed planner inputs
	{ id: "learning.pv_bias.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
	{ id: "learning.pv_horizon.", match: "prefix", class: "forecast", reasonCode: "forecast_change", ackPolicy: "ack_true" },
	{ id: "learning.house_load.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
	{ id: "learning.weather.", match: "prefix", class: "forecast", reasonCode: "forecast_change", ackPolicy: "ack_true" },
	{ id: "learning.thermal_runtime.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
	// Battery / wallbox / immersion / AC planning surfaces
	{ id: "battery.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "wallbox.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "immersion_heater.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "air_conditioning.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
	{ id: "addons.governance.", match: "prefix", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
	{ id: "user_intent.", match: "prefix", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
	// Mapping-related control objects (conscious writes)
	{ id: "mapping.", match: "prefix", class: "mapping", reasonCode: "mapping_change", ackPolicy: "conscious" },
];

/**
 * Hard exclude — never auto-trigger, even if an allowlist prefix would match.
 * Prevents self-reinforcing loops from planner outputs / coordinator diagnostics.
 */
export const PLANNER_TRIGGER_DENYLIST_PREFIXES: readonly string[] = [
	"planner.coordinator.",
	"planner.forecast.",
	"planner.daily.",
	"planner.trigger.",
	"operator.forecast.",
	"operator.daily_plan.",
	"operator.supply.grid.",
	"operator.contributions.",
	"forecast_plan",
	"daily_plan",
];

export function isDeniedPlannerTriggerState(relativeId: string): boolean {
	return PLANNER_TRIGGER_DENYLIST_PREFIXES.some(
		(p) => relativeId === p || relativeId.startsWith(p),
	);
}

function ackMatches(policy: CatalogEntry["ackPolicy"], ack: boolean | undefined): boolean {
	if (policy === "any") return true;
	if (policy === "conscious") return ack !== true;
	if (policy === "ack_true") return ack === true;
	return false;
}

export function matchPlannerTriggerState(
	relativeId: string,
	ack: boolean | undefined,
): CatalogEntry | null {
	if (isDeniedPlannerTriggerState(relativeId)) {
		return null;
	}
	for (const entry of PLANNER_TRIGGER_ALLOWLIST) {
		const matches =
			entry.match === "exact" ? relativeId === entry.id : relativeId.startsWith(entry.id);
		if (!matches) continue;
		if (!ackMatches(entry.ackPolicy, ack)) continue;
		return entry;
	}
	return null;
}

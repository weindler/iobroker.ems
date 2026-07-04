/** Deterministic EMS planner — Phase 1 MVP (dryrun-first). */

export const PLANNER_SCHEMA_VERSION = 1;
export const PLANNER_ENGINE_VERSION = "0.2.0";

export type PlannerBatteryAction = "none" | "charge" | "self_consumption" | "hold";

export interface PlannerGlobalModeContext {
	active: string;
	policy_label_de: string;
}

export interface PlannerThermalDecision {
	commanded_stage: number;
	commanded_power_w: number;
	reason_de: string;
}

export interface PlannerBatteryDecision {
	action: PlannerBatteryAction;
	max_charge_w: number;
	target_soc_pct: number | null;
	reason_de: string;
}

export interface PlannerConstraints {
	evcc_battery_hold: boolean;
	evcc_battery_discharge_control: boolean;
	/** user_intent hold (z. B. günstiger Strompreis / Netzladung geplant). */
	user_intent_battery_hold: boolean;
	battery_hold_active: boolean;
	reason_de: string;
}

export interface PlannerIntent {
	schema_version: typeof PLANNER_SCHEMA_VERSION;
	revision: number;
	resolved_at: string;
	reason_de: string;
	global_mode: PlannerGlobalModeContext;
	surplus_w: number | null;
	deficit_w: number | null;
	pv_power_w: number | null;
	house_load_w: number | null;
	constraints: PlannerConstraints;
	thermal: PlannerThermalDecision;
	battery: PlannerBatteryDecision;
}

export function emptyPlannerIntent(now: Date): PlannerIntent {
	const iso = now.toISOString();
	return {
		schema_version: PLANNER_SCHEMA_VERSION,
		revision: 0,
		resolved_at: iso,
		reason_de: "Planner initialisiert, keine Entscheidung.",
		surplus_w: null,
		pv_power_w: null,
		house_load_w: null,
		constraints: {
			evcc_battery_hold: false,
			evcc_battery_discharge_control: false,
			user_intent_battery_hold: false,
			battery_hold_active: false,
			reason_de: "",
		},
		global_mode: { active: "balanced", policy_label_de: "" },
		deficit_w: null,
		thermal: { commanded_stage: 0, commanded_power_w: 0, reason_de: "Kein Heizstab-Auftrag." },
		battery: { action: "none", max_charge_w: 0, target_soc_pct: null, reason_de: "Kein Batterie-Auftrag." },
	};
}

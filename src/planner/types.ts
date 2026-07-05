/** Deterministic EMS planner — Phase 1 MVP (dryrun-first). */

export const PLANNER_SCHEMA_VERSION = 1;
export const PLANNER_ENGINE_VERSION = "0.4.0";

export type PlannerBatteryAction = "none" | "charge" | "self_consumption" | "hold";

export interface PlannerGlobalModeContext {
	active: string;
	policy_label_de: string;
}

export interface PlannerThermalDecision {
	commanded_stage: number;
	commanded_power_w: number;
	reason_de: string;
	target_temp_c: number;
	target_reason_de: string;
	forecast_active: boolean;
}

export interface PlannerBatteryDecision {
	action: PlannerBatteryAction;
	max_charge_w: number;
	target_soc_pct: number | null;
	reason_de: string;
}

export interface PlannerBatteryWinterDecision {
	active: boolean;
	forecast_active: boolean;
	horizon_days: number;
	bridge_until_iso: string | null;
	pv_recovery_day: number | null;
	energy_stored_kwh: number | null;
	energy_deficit_kwh: number | null;
	energy_reserve_kwh: number | null;
	energy_target_kwh: number | null;
	soc_target_pct: number | null;
	charge_energy_kwh: number | null;
	charge_duration_h: number | null;
	charge_slots_15m: number | null;
	confidence_min_pct: number | null;
	windows_json: string;
	reason_de: string;
}

export interface PlannerCoolingDecision {
	expected_kwh_today: number;
	expected_peak_w: number;
	likely_active: boolean;
	reason_de: string;
	forecast_active: boolean;
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
	cooling: PlannerCoolingDecision;
	battery: PlannerBatteryDecision;
	battery_winter: PlannerBatteryWinterDecision;
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
		thermal: {
			commanded_stage: 0,
			commanded_power_w: 0,
			reason_de: "Kein Heizstab-Auftrag.",
			target_temp_c: 60,
			target_reason_de: "",
			forecast_active: false,
		},
		cooling: {
			expected_kwh_today: 0,
			expected_peak_w: 0,
			likely_active: false,
			reason_de: "Kein Klima-Auftrag.",
			forecast_active: false,
		},
		battery: { action: "none", max_charge_w: 0, target_soc_pct: null, reason_de: "Kein Batterie-Auftrag." },
		battery_winter: {
			active: false,
			forecast_active: false,
			horizon_days: 0,
			bridge_until_iso: null,
			pv_recovery_day: null,
			energy_stored_kwh: null,
			energy_deficit_kwh: null,
			energy_reserve_kwh: null,
			energy_target_kwh: null,
			soc_target_pct: null,
			charge_energy_kwh: null,
			charge_duration_h: null,
			charge_slots_15m: null,
			confidence_min_pct: null,
			windows_json: "[]",
			reason_de: "Winter-Netzplanung nicht aktiv.",
		},
	};
}

import type { IntentField, IntentState, ManualOverrideState } from "../core/types";
import { INTENT_SCHEMA_VERSION, WALLBOX_TARGET_ID } from "../core/constants";

export interface ResolvedWallboxIntent {
	schema_version: typeof INTENT_SCHEMA_VERSION;
	domain: "wallbox";
	target: { id: string };
	revision: number;
	intent_state: IntentState;
	resolved_at: string;
	charge_strategy: IntentField<import("../core/types").WallboxChargeStrategy>;
	target_soc_pct: IntentField<number>;
	deadline: IntentField<import("../core/types").WallboxDeadlineValue>;
	external_planner_plan: ExternalWallboxPlan;
	manual_override: ManualOverrideState;
	source_summary: string[];
}

export type ExternalWallboxPlanState = "active" | "none" | "expired" | "invalid";

export interface ExternalWallboxPlan {
	state: ExternalWallboxPlanState;
	plan_type: "soc" | "energy" | "unknown";
	target_soc_pct: number | null;
	target_energy_kwh: number | null;
	ready_at: string | null;
	source: "evcc";
	observed_at: string;
}

export interface EvccIntentSnapshot {
	observed_at: string;
	charge_strategy: IntentField<import("../core/types").WallboxChargeStrategy>;
	target_soc_pct: IntentField<number>;
	deadline: IntentField<import("../core/types").WallboxDeadlineValue>;
	status: "ok" | "partial" | "unconfigured" | "error";
	last_error?: string;
}

export interface AdminIntentSnapshot {
	observed_at: string;
	charge_strategy: IntentField<import("../core/types").WallboxChargeStrategy> | null;
	target_soc_pct: IntentField<number> | null;
	timezone: string;
}

export interface IobrokerIntentSnapshot {
	observed_at: string;
	charge_strategy: IntentField<import("../core/types").WallboxChargeStrategy> | null;
	target_soc_pct: IntentField<number> | null;
	deadline: IntentField<import("../core/types").WallboxDeadlineValue> | null;
	manual_override: ManualOverrideState | null;
	request_id: string | null;
}

export function emptyResolvedWallboxIntent(now: Date): ResolvedWallboxIntent {
	const iso = now.toISOString();
	const emptyOrigin = {
		source: "unknown" as const,
		owner: "unknown" as const,
		change_kind: "unknown" as const,
	};
	const emptyField = <T>(): IntentField<T> => ({
		value: null,
		status: "missing",
		origin: emptyOrigin,
		observed_at: iso,
	});
	return {
		schema_version: INTENT_SCHEMA_VERSION,
		domain: "wallbox",
		target: { id: WALLBOX_TARGET_ID },
		revision: 0,
		intent_state: "none",
		resolved_at: iso,
		charge_strategy: emptyField(),
		target_soc_pct: emptyField(),
		deadline: emptyField(),
		external_planner_plan: {
			state: "none",
			plan_type: "unknown",
			target_soc_pct: null,
			target_energy_kwh: null,
			ready_at: null,
			source: "evcc",
			observed_at: iso,
		},
		manual_override: {
			active: false,
			scope: [],
			source: "unknown",
			owner: "unknown",
		},
		source_summary: [],
	};
}

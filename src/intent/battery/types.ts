import { INTENT_SCHEMA_VERSION } from "../core/constants";
import type { IntentField, IntentState, ManualOverrideState } from "../core/types";

export type BatteryOperatingRequest = "auto" | "protect" | "hold" | "charge" | "discharge" | "off" | "unknown";
export type BatteryGridChargeRequest = "auto" | "allow" | "deny" | "unknown";

export interface ResolvedBatteryIntent {
	schema_version: typeof INTENT_SCHEMA_VERSION;
	domain: "battery";
	target: { id: string };
	revision: number;
	intent_state: IntentState;
	resolved_at: string;
	operating_request: IntentField<BatteryOperatingRequest>;
	target_soc_pct: IntentField<number>;
	grid_charge_request: IntentField<BatteryGridChargeRequest>;
	ev_discharge_allowed: IntentField<boolean>;
	top_off_requested: IntentField<boolean>;
	manual_override: ManualOverrideState;
	source_summary: string[];
}

export interface IobrokerBatterySnapshot {
	observed_at: string;
	operating_request: IntentField<BatteryOperatingRequest> | null;
	target_soc_pct: IntentField<number> | null;
	grid_charge_request: IntentField<BatteryGridChargeRequest> | null;
	ev_discharge_allowed: IntentField<boolean> | null;
	top_off_requested: IntentField<boolean> | null;
	manual_override: ManualOverrideState | null;
	request_id: string | null;
}

export function emptyResolvedBatteryIntent(now: Date, targetId: string): ResolvedBatteryIntent {
	const iso = now.toISOString();
	const emptyOrigin = { source: "unknown" as const, owner: "unknown" as const, change_kind: "unknown" as const };
	const emptyField = <T>(): IntentField<T> => ({
		value: null,
		status: "missing",
		origin: emptyOrigin,
		observed_at: iso,
	});
	return {
		schema_version: INTENT_SCHEMA_VERSION,
		domain: "battery",
		target: { id: targetId },
		revision: 0,
		intent_state: "disabled",
		resolved_at: iso,
		operating_request: emptyField(),
		target_soc_pct: emptyField(),
		grid_charge_request: emptyField(),
		ev_discharge_allowed: emptyField(),
		top_off_requested: emptyField(),
		manual_override: { active: false, scope: [], source: "unknown", owner: "unknown" },
		source_summary: [],
	};
}

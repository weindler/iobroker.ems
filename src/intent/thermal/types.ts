import { INTENT_SCHEMA_VERSION } from "../core/constants";
import type { IntentField, IntentState, ManualOverrideState } from "../core/types";

export type ThermalOperatingRequest = "off" | "auto" | "force_on" | "force_off" | "unknown";
export type ThermalPriority = "normal" | "before_ev" | "after_ev" | "unknown";

export interface ThermalReadyAt {
	at: string;
	timezone: string;
}

export interface ResolvedThermalIntent {
	schema_version: typeof INTENT_SCHEMA_VERSION;
	domain: "thermal";
	target: { id: string };
	revision: number;
	intent_state: IntentState;
	resolved_at: string;
	operating_request: IntentField<ThermalOperatingRequest>;
	target_temperature_c: IntentField<number>;
	ready_at: IntentField<ThermalReadyAt>;
	priority: IntentField<ThermalPriority>;
	manual_override: ManualOverrideState;
	source_summary: string[];
}

export interface IobrokerThermalSnapshot {
	observed_at: string;
	operating_request: IntentField<ThermalOperatingRequest> | null;
	target_temperature_c: IntentField<number> | null;
	ready_at: IntentField<ThermalReadyAt> | null;
	priority: IntentField<ThermalPriority> | null;
	manual_override: ManualOverrideState | null;
	request_id: string | null;
}

export function emptyResolvedThermalIntent(now: Date, targetId: string): ResolvedThermalIntent {
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
		domain: "thermal",
		target: { id: targetId },
		revision: 0,
		intent_state: "disabled",
		resolved_at: iso,
		operating_request: emptyField(),
		target_temperature_c: emptyField(),
		ready_at: emptyField(),
		priority: emptyField(),
		manual_override: { active: false, scope: [], source: "unknown", owner: "unknown" },
		source_summary: [],
	};
}

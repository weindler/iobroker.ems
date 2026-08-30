import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function boolState(id: string, name: string, def?: boolean): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "state", read: true, write: false, def },
		defaultVal: def,
	};
}

/** BLOCK B — kompakter Explainability-State (siehe `PlannerLearningExplanation`), rein diagnostisch. */
function jsonState(id: string, name: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "json", read: true, write: false, def: "null" },
		defaultVal: "null",
		setDefaultIfEmpty: true,
	};
}

export type EnsurePlannerStatesOptions = {
	/**
	 * @deprecated Roadmap Block 5 — thermal/cooling/winter Intent-Bäume werden nicht mehr angelegt
	 * und per Surface-Cleanup entfernt. Parameter bleiben für API-Kompatibilität ignoriert.
	 */
	includeThermal?: boolean;
	/** @deprecated Roadmap Block 5 — ignoriert. */
	includeCooling?: boolean;
	/** @deprecated Roadmap Block 5 — ignoriert. */
	includeWinter?: boolean;
};

/**
 * Planner-/Constraint-Hülle ohne Legacy Realtime-Intent-Bäume (Block 5).
 * Forecast/Daily/Allocation werden separat via Operator ensure_* angelegt.
 */
export async function ensurePlannerStates(
	host: StateHost,
	_options?: EnsurePlannerStatesOptions,
): Promise<void> {
	await ensureChannel(host, "planner", "EMS Planner");
	await ensureChannel(host, "planner.intent", "Planner Intents");
	await ensureChannel(host, "planner.constraints", "Planner Constraints");

	const defs: StateDef[] = [
		strState("planner.status", "Planner Status", "initializing"),
		strState("planner.last_run_at", "Planner letzter Lauf (ISO)"),
		strState("planner.global_mode.active", "Planner Global Mode", "balanced"),
		boolState("planner.constraints.evcc_battery_hold", "Planner EVCC Batterie-Hold", false),
		boolState("planner.constraints.battery_hold_active", "Planner Batterie-Hold gesamt", false),
		boolState(
			"planner.constraints.battery_consumer_immersion_allowed",
			"Batterie für Heizstab jetzt erlaubt",
			false,
		),
		strState(
			"planner.constraints.battery_consumer_immersion_reason_de",
			"Batterie Heizstab Begründung",
			"",
		),
		boolState(
			"planner.constraints.battery_consumer_climate_allowed",
			"Batterie für Klima jetzt erlaubt",
			false,
		),
		strState(
			"planner.constraints.battery_consumer_climate_reason_de",
			"Batterie Klima Begründung",
			"",
		),
		boolState(
			"planner.constraints.battery_consumer_wallbox_allowed",
			"Batterie für Wallbox jetzt erlaubt",
			false,
		),
		strState(
			"planner.constraints.battery_consumer_wallbox_reason_de",
			"Batterie Wallbox Begründung",
			"",
		),
		/*
		 * Phase 1b: wirtschaftliche Entlade-Entscheidung des Unified Planners für den
		 * aktuellen Slot — grid_balance übernimmt max_discharge_w nur als Obergrenze,
		 * Hardware-/Ownership-Gates bleiben lokal in der Batterie-Runtime.
		 */
		boolState(
			"planner.battery_discharge.allowed",
			"Batterie-Entladung (Netzausgleich) wirtschaftlich erlaubt",
			false,
		),
		{
			id: "planner.battery_discharge.max_discharge_w",
			common: { name: "Batterie-Entladebudget (Netzausgleich) W", type: "number", role: "value", read: true, write: false, def: 0 },
			defaultVal: 0,
		},
		strState(
			"planner.battery_discharge.reason_de",
			"Batterie-Entladebudget Begründung",
			"",
		),
		/*
		 * BLOCK B — Battery Opportunity Cost (Explainability, additiv). Rein informativ;
		 * steuert nichts direkt, siehe `battery_opportunity_cost.ts`/`battery_discharge_authority.ts`.
		 */
		{
			id: "planner.battery_discharge.opportunity_cost_ct_per_kwh",
			common: { name: "Batterie Opportunity-Cost (ct/kWh, Block B)", type: "number", role: "value", read: true, write: false, def: null as unknown as number, unit: "ct/kWh" },
			defaultVal: null as unknown as ioBroker.StateValue,
			setDefaultIfEmpty: true,
		},
		boolState(
			"planner.battery_discharge.opportunity_allowed",
			"Netzausgleich trotz Opportunity-Cost weiterhin erlaubt (Block B)",
			true,
		),
		/*
		 * BLOCK B — Learned Planner Explainability (kompakt, JSON, rein diagnostisch).
		 * baselineDecision/adjustedDecision/changedByLearning/reasonCodes/confidencePct/
		 * learningMetrics — siehe `operator/daily_plan/unified/learning_explanation.ts`.
		 * Keine Steuerwirkung; nur Nachvollziehbarkeit, ob/warum Block-A-Learning eine reale
		 * Entscheidung verändert hat.
		 */
		jsonState(
			"planner.learning.thermal_explanation",
			"Thermal Opportunity — Learned-Planner-Explainability (Block B, JSON)",
		),
		jsonState(
			"planner.learning.battery_explanation",
			"Battery Opportunity — Learned-Planner-Explainability (Block B, JSON)",
		),
		/*
		 * Zentrale Batterie-Reserve — führt learning/battery_runtime (reale Historie),
		 * next_reliable_pv.ts (Forecast) und die battery.charge-Contribution (bestehendes
		 * Lade-/Reserveziel) zu EINER Zielgröße zusammen; für Lade- UND Entladeplanung.
		 */
		{
			id: "planner.battery_reserve.required_soc_at_pv_end_pct",
			common: { name: "Zentrale Batterie-Reserve SOC-Ziel (%)", type: "number", role: "value", read: true, write: false, def: null as unknown as number, unit: "%" },
			defaultVal: null as unknown as ioBroker.StateValue,
			setDefaultIfEmpty: true,
		},
		{
			id: "planner.battery_reserve.predicted_consumption_until_next_pv_kwh",
			common: { name: "Erwarteter Verbrauch bis nächstem PV-Fenster (kWh)", type: "number", role: "value", read: true, write: false, def: null as unknown as number, unit: "kWh" },
			defaultVal: null as unknown as ioBroker.StateValue,
			setDefaultIfEmpty: true,
		},
		strState("planner.battery_reserve.next_reliable_pv_iso", "Nächstes verlässliches PV-Fenster (ISO)", ""),
		strState(
			"planner.battery_reserve.estimated_battery_empty_at_iso",
			"Batterie voraussichtlich leer ab (ISO)",
			"",
		),
		{
			id: "planner.battery_reserve.energy_to_target_kwh",
			common: { name: "Ladebedarf bis Reserve-Ziel (kWh)", type: "number", role: "value", read: true, write: false, def: null as unknown as number, unit: "kWh" },
			defaultVal: null as unknown as ioBroker.StateValue,
			setDefaultIfEmpty: true,
		},
		{
			id: "planner.battery_reserve.estimated_charge_time_to_target_hours",
			common: { name: "Geschätzte Ladezeit bis Reserve-Ziel (h)", type: "number", role: "value", read: true, write: false, def: null as unknown as number, unit: "h" },
			defaultVal: null as unknown as ioBroker.StateValue,
			setDefaultIfEmpty: true,
		},
		strState("planner.battery_reserve.reason_de", "Zentrale Batterie-Reserve Begründung", ""),
	];

	await ensureStates(host, defs);
}

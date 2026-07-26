import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def?: boolean): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "state", read: true, write: false, def },
		defaultVal: def,
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
	await ensureChannel(host, "planner.intent.battery", "Planner Batterie");
	await ensureChannel(host, "planner.constraints", "Planner Constraints");

	const defs: StateDef[] = [
		strState("planner.status", "Planner Status", "initializing"),
		strState("planner.last_run_at", "Planner letzter Lauf (ISO)"),
		strState("planner.global_mode.active", "Planner Global Mode", "balanced"),
		strState("planner.intent.last_json", "Planner letzter Intent (JSON)", "{}"),
		strState("planner.intent.last_reason_de", "Planner letzte Begründung (DE)", ""),
		strState("planner.intent.battery.action", "Planner Batterie Aktion (Diagnose)", "none"),
		numState("planner.intent.battery.max_charge_w", "Planner Batterie max. Ladeleistung W", 0),
		strState("planner.intent.battery.reason_de", "Planner Batterie Begründung", ""),
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
	];

	await ensureStates(host, defs);
}

import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, unit },
	};
}

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export async function ensureThermalBoilerLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.thermal_boiler", "EMS-Light Learning Boiler-Runtime");
	const defs: StateDef[] = [
		strState("learning.thermal_boiler.status", "Boiler-Learning Status", "not_initialized"),
		strState("learning.thermal_boiler.health", "Boiler-Learning Health"),
		strState("learning.thermal_boiler.last_run", "Boiler-Learning letzter Lauf (ISO)"),
		strState("learning.thermal_boiler.last_sample_at", "Boiler letzter Istwert-Sample (ISO)"),
		strState("learning.thermal_boiler.last_error", "Boiler-Learning Fehler"),
		numState("learning.thermal_boiler.samples", "Boiler-Learning Zyklen"),
		numState("learning.thermal_boiler.cooling_rate_c_per_h_avg", "Boiler Ø Kühlrate", "°C/h"),
		numState("learning.thermal_boiler.cooling_k_per_h", "Boiler Newton-k", "1/h"),
		numState("learning.thermal_boiler.cooling_asymptote_c", "Boiler Asymptote", "°C"),
		numState("learning.thermal_boiler.current_temperature_c", "Boiler aktuelle Temperatur", "°C"),
		numState("learning.thermal_boiler.estimated_remaining_hours", "Boiler Restlaufzeit", "h"),
		strState("learning.thermal_boiler.estimated_empty_at", "Boiler geschätzt leer um (ISO)"),
		strState("learning.thermal_boiler.by_day_type_json", "Boiler nach Day-Type (JSON)", "{}"),
		strState("learning.thermal_boiler.model", "Boiler-Kühlmodell", "none"),
		strState("learning.thermal_boiler.quality", "Boiler-Learning Qualität", "insufficient_data"),
		strState(
			"learning.thermal_boiler.reason_de",
			"Boiler-Learning Begründung",
			"Noch keine Boiler-Daten — lernt.",
		),
	];
	await ensureStates(host, defs);
}

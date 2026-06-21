import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: {
			name,
			type: "number",
			role: "value",
			read: true,
			write: false,
			unit,
		},
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

export async function ensureThermalRuntimeLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.thermal_runtime", "EMS-Light Learning Thermik-Runtime");

	const defs: StateDef[] = [
		strState("learning.thermal_runtime.status", "Thermal-Runtime-Learning Status", "not_initialized"),
		strState("learning.thermal_runtime.health", "Thermal-Runtime Health"),
		strState("learning.thermal_runtime.last_run", "Thermal-Runtime letzter Lauf (ISO)"),
		strState("learning.thermal_runtime.last_error", "Thermal-Runtime Fehler"),
		numState("learning.thermal_runtime.samples", "Thermal-Runtime Zyklen (Samples)"),
		numState("learning.thermal_runtime.runtime_hours_avg", "Thermal-Runtime Ø Stunden", "h"),
		numState("learning.thermal_runtime.runtime_hours_median", "Thermal-Runtime Median Stunden", "h"),
		numState(
			"learning.thermal_runtime.cooling_rate_c_per_h_avg",
			"Thermal-Runtime Ø Kühlrate",
			"°C/h",
		),
		numState("learning.thermal_runtime.current_temperature_c", "Thermal-Runtime aktuelle Temperatur", "°C"),
		numState("learning.thermal_runtime.estimated_remaining_hours", "Thermal-Runtime Restlaufzeit", "h"),
		strState("learning.thermal_runtime.estimated_empty_at", "Thermal-Runtime geschätzt leer um (ISO)"),
		strState("learning.thermal_runtime.by_season_json", "Thermal-Runtime nach Saison (JSON)"),
		strState("learning.thermal_runtime.by_day_type_json", "Thermal-Runtime nach Day-Type (JSON)"),
		strState("learning.thermal_runtime.history_json", "Thermal-Runtime Zyklen-Historie (JSON)"),
	];

	await ensureStates(host, defs);
}

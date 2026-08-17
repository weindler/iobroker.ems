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

/** Lean KPI surface — Power-History-Diagnose bleibt in der Datei / Logs. */
export async function ensureBatteryRuntimeLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.battery_runtime", "EMS-Light Learning Batterie-Runtime");

	const defs: StateDef[] = [
		strState("learning.battery_runtime.status", "Battery-Runtime-Learning Status", "not_initialized"),
		strState("learning.battery_runtime.last_run", "Battery-Runtime letzter Lauf (ISO)"),
		numState("learning.battery_runtime.sample_days", "Battery-Runtime Sample-Tage"),
		numState("learning.battery_runtime.avg_night_discharge_kwh", "Battery-Runtime Ø Nachtentladung", "kWh"),
		numState("learning.battery_runtime.avg_charge_power_w", "Battery-Runtime Ø Ladeleistung", "W"),
		numState("learning.battery_runtime.max_charge_power_w", "Battery-Runtime max. Ladeleistung (Ist)", "W"),
		strState("learning.battery_runtime.last_full_charge", "Battery-Runtime letzte Vollladung (ISO)"),
		numState("learning.battery_runtime.days_since_full", "Battery-Runtime Tage seit Vollladung"),
		numState("learning.battery_runtime.topoff_days_remaining", "Battery-Runtime Top-Off Tage verbleibend"),
		numState("learning.battery_runtime.topoff_due", "Battery-Runtime Top-Off fällig (0/1)"),
		numState("learning.battery_runtime.estimated_runtime_days", "Battery-Runtime geschätzte Laufzeit", "Tage"),
	];

	await ensureStates(host, defs);
}

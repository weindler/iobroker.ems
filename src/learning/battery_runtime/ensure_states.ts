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

export async function ensureBatteryRuntimeLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.battery_runtime", "EMS-Light Learning Batterie-Runtime");

	const defs: StateDef[] = [
		strState("learning.battery_runtime.status", "Battery-Runtime-Learning Status", "not_initialized"),
		strState("learning.battery_runtime.last_run", "Battery-Runtime letzter Lauf (ISO)"),
		numState("learning.battery_runtime.sample_days", "Battery-Runtime Sample-Tage"),
		numState("learning.battery_runtime.avg_night_discharge_pct", "Battery-Runtime Ø Nachtentladung", "%"),
		numState("learning.battery_runtime.avg_night_discharge_kwh", "Battery-Runtime Ø Nachtentladung", "kWh"),
		numState("learning.battery_runtime.avg_charge_rate_pct_h", "Battery-Runtime Ø Laderate", "%/h"),
		numState("learning.battery_runtime.avg_discharge_rate_pct_h", "Battery-Runtime Ø Entladerate", "%/h"),
		numState("learning.battery_runtime.avg_charge_power_w", "Battery-Runtime Ø Ladeleistung", "W"),
		numState("learning.battery_runtime.avg_discharge_power_w", "Battery-Runtime Ø Entladeleistung", "W"),
		numState("learning.battery_runtime.max_charge_power_w", "Battery-Runtime max. Ladeleistung (Ist)", "W"),
		numState("learning.battery_runtime.max_discharge_power_w", "Battery-Runtime max. Entladeleistung (Ist)", "W"),
		strState("learning.battery_runtime.last_full_charge", "Battery-Runtime letzte Vollladung (ISO)"),
		numState("learning.battery_runtime.days_since_full", "Battery-Runtime Tage seit Vollladung"),
		numState("learning.battery_runtime.seconds_since_full_charge", "Sekunden seit Vollladung (Gerät)", "s"),
		strState("learning.battery_runtime.full_charge_source", "Vollladung Quelle (device|soc_history)"),
		numState("learning.battery_runtime.topoff_interval_days", "Battery-Runtime Top-Off Intervall (Konfig)"),
		numState("learning.battery_runtime.topoff_days_remaining", "Battery-Runtime Top-Off Tage verbleibend"),
		numState("learning.battery_runtime.topoff_due", "Battery-Runtime Top-Off fällig (0/1)"),
		numState("learning.battery_runtime.estimated_runtime_days", "Battery-Runtime geschätzte Laufzeit", "Tage"),
		numState("learning.battery_runtime.power_history_raw_rows", "Battery-Runtime Power-History Zeilen gesamt"),
		numState("learning.battery_runtime.power_history_normalized_rows", "Battery-Runtime Power-History gültige Zeilen"),
		numState("learning.battery_runtime.power_raw_charge_samples", "Battery-Runtime Power Roh-Lade-Samples"),
		numState("learning.battery_runtime.power_raw_discharge_samples", "Battery-Runtime Power Roh-Entlade-Samples"),
		numState("learning.battery_runtime.power_hourly_charge_points", "Battery-Runtime Power Stunden-Lade-Peaks"),
		numState("learning.battery_runtime.power_hourly_discharge_points", "Battery-Runtime Power Stunden-Entlade-Peaks"),
		numState("learning.battery_runtime.power_invert_applied", "Battery-Runtime Power-Invert aktiv (0/1)"),
		numState("learning.battery_runtime.power_invert_auto", "Battery-Runtime Power-Invert auto (0/1)"),
	];

	await ensureStates(host, defs);
}

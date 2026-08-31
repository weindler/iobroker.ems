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
		numState("learning.battery_runtime.avg_night_bridge_hours", "Battery-Runtime Ø Nachtbrücken-Dauer", "h"),
		/*
		 * Phase 1d — dynamische Nachtverbrauchs-Erfassung/-Prognose und daraus abgeleitete
		 * Batterie-Reserve (ersetzt feste 50-%-Schwelle im Planner-Netzausgleich-Budget).
		 */
		numState(
			"learning.battery_runtime.predicted_night_consumption_kwh",
			"Battery-Runtime Reserve-Basis (= Ø Nachtentladung, SOC-basiert)",
			"kWh",
		),
		numState(
			"learning.battery_runtime.night_consumption_valid_nights",
			"Battery-Runtime Nächte mit Hauslast-Diagnose (nicht Reserve-relevant)",
		),
		numState(
			"learning.battery_runtime.predicted_night_grid_import_kwh",
			"Battery-Runtime Ø Nacht-Netzbezug (Diagnose, keine Reserve-Größe)",
			"kWh",
		),
		numState("learning.battery_runtime.avg_night_load_w", "Battery-Runtime Ø effektive Nachtlast (aus Reserve-Basis)", "W"),
		numState(
			"learning.battery_runtime.required_soc_at_pv_end_pct",
			"Battery-Runtime Reserve bei PV-Ende (nur aus Historie — Diagnose)",
			"%",
		),
		numState(
			"learning.battery_runtime.required_night_reserve_kwh",
			"Battery-Runtime dynamische Reserve bei PV-Ende",
			"kWh",
		),
		strState("learning.battery_runtime.night_reserve_reason_de", "Battery-Runtime Reserve-Begründung", ""),
		strState("learning.battery_runtime.night_bridge_method", "Battery-Runtime Nachtbrücken-Methode", "none"),
		numState("learning.battery_runtime.night_bridge_pv_points", "Battery-Runtime PV-Punkte für Nachtbrücke"),
		numState("learning.battery_runtime.night_bridge_house_points", "Battery-Runtime Hauslast-Punkte für Nachtbrücke"),
		strState("learning.battery_runtime.night_bridge_pv_origin", "Battery-Runtime PV-Quellenart", "none"),
		numState("learning.battery_runtime.night_bridge_valid_nights", "Battery-Runtime gültige Nachtbrücken"),
		numState(
			"learning.battery_runtime.grid_balance_attributed_nights",
			"Battery-Runtime Nächte mit abgezogener Netzausgleichs-Energie",
		),
		numState(
			"learning.battery_runtime.grid_balance_excluded_nights",
			"Battery-Runtime Nächte ausgeschlossen (Netzausgleichs-Anteil nicht bestimmbar)",
		),
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

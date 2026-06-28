import { ensureEmsLightChannels } from "./channels";
import { ensureStates, type StateDef, type StateHost } from "./state_util";

const OPERATOR_BRIEFING_DEFAULT =
	"EMS-Light Phase 1 aktiv. Planner noch nicht initialisiert.";

function strState(
	id: string,
	name: string,
	def?: string,
	opts?: { alwaysUpdate?: boolean },
): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: !opts?.alwaysUpdate,
		alwaysUpdate: opts?.alwaysUpdate,
	};
}

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

export async function ensureEmsLightStates(host: StateHost, adapterVersion: string): Promise<void> {
	await ensureEmsLightChannels(host);

	const defs: StateDef[] = [
		strState("system.version", "EMS-Light Adapter-Version", adapterVersion, { alwaysUpdate: true }),
		strState("system.mode", "EMS-Light Modus", "ems_light"),
		strState("system.last_tick_at", "EMS-Light letzter Tick (ISO)"),
		strState("system.health", "EMS-Light Health", "initializing"),

		numState("live.battery.soc_pct", "Live Batterie SOC", "%"),
		numState("live.battery.capacity_kwh", "Live Batteriekapazität", "kWh"),
		numState("live.battery.pv_ac_power_w", "Live PV AC Leistung", "W"),
		numState("live.battery.house_load_w", "Live Hauslast (Verbrauch)", "W"),
		numState("live.wallbox.enabled", "Live Wallbox freigegeben (0/1)"),
		numState("live.wallbox.charging", "Live Wallbox laden aktiv (0/1)"),
		numState("live.wallbox.charge_power_w", "Live Wallbox Ladeleistung", "W"),
		numState("live.wallbox.vehicle_soc_pct", "Live Fahrzeug-SOC", "%"),
		numState("live.thermal.buffer_temp_c", "Live Puffer-Temperatur", "°C"),
		numState("live.pv.power_w", "Live PV-Leistung", "W"),
		numState("live.price.now_ct_per_kwh", "Live Strompreis jetzt", "ct/kWh"),

		strState("learning.house_load.status", "Learning Hauslast Status", "not_initialized"),
		strState("learning.battery_runtime.status", "Learning Batterie Runtime Status", "not_initialized"),
		strState("learning.thermal_runtime.status", "Learning Thermik Runtime Status", "not_initialized"),

		strState("planner.intent.last_json", "Planner letzter Intent (JSON)"),
		strState("planner.intent.last_reason_de", "Planner letzte Begründung (DE)"),

		strState("operator.briefing_de", "Operator Briefing (DE)", OPERATOR_BRIEFING_DEFAULT),

		strState("execution.safety.global_execution_mode", "Spiegel global.execution_mode"),
		strState("execution.safety.summary_de", "Execution Safety Zusammenfassung"),

		numState("economics.config.fixed_price_ct_per_kwh", "Economics Festpreis", "ct/kWh"),
		numState("economics.config.monthly_base_fee_eur", "Economics Grundgebühr/Monat", "EUR"),
		numState("economics.config.grid_fee_ct_per_kwh", "Economics Netzentgelt", "ct/kWh"),
		numState("economics.config.feed_in_ct_per_kwh", "Economics Einspeisevergütung", "ct/kWh"),
		numState("economics.config.battery_cycle_cost_ct_per_kwh", "Economics Batterie Zyklenkosten", "ct/kWh"),
		numState("economics.today.dynamic_cost_eur", "Economics heute dynamisch", "EUR"),
		numState("economics.today.fixed_tariff_cost_eur", "Economics heute Festpreis", "EUR"),
		numState("economics.today.savings_eur", "Economics heute Ersparnis", "EUR"),
		numState("economics.month.savings_eur", "Economics Monat Ersparnis", "EUR"),
		numState("economics.year.savings_eur", "Economics Jahr Ersparnis", "EUR"),
		strState("economics.reason_de", "Economics Hinweis (DE)"),
	];

	await ensureStates(host, defs);
}

import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
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

export async function ensurePvBiasStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.pv_bias", "EMS-Light Learning PV-Bias");

	const defs: StateDef[] = [
		numState("learning.pv_bias.bias_today_pct", "PV-Bias heute", "%"),
		numState("learning.pv_bias.bias_7d_pct", "PV-Bias 7 Tage", "%"),
		numState("learning.pv_bias.bias_30d_pct", "PV-Bias 30 Tage", "%"),
		numState("learning.pv_bias.corrected_today_kwh", "PV korrigiert heute", "kWh"),
		numState("learning.pv_bias.corrected_tomorrow_kwh", "PV korrigiert morgen", "kWh"),
		numState("learning.pv_bias.confidence_pct", "PV-Bias Confidence", "%"),
		numState("learning.pv_bias.raw_today_kwh", "PV Rohforecast heute", "kWh"),
		numState("learning.pv_bias.raw_tomorrow_kwh", "PV Rohforecast morgen", "kWh"),
		numState("learning.pv_bias.sample_days_7d", "PV-Bias gültige Tage 7d"),
		numState("learning.pv_bias.sample_days_30d", "PV-Bias gültige Tage 30d"),
		strState("learning.pv_bias.last_update_ts", "PV-Bias letztes Update (ISO)"),
		strState("learning.pv_bias.status", "Learning PV-Bias Status", "not_initialized"),
		strState("learning.pv_bias.reason", "Learning PV-Bias Hinweis"),
		strState("learning.pv_bias.freeze_time", "PV-Bias Freeze-Zeit (HH:MM)", "06:00"),
		strState("learning.pv_bias.frozen_at_ts", "PV-Bias Forecast eingefroren um (ISO)"),
		numState("learning.pv_bias.frozen_today_kwh", "PV eingefrorener Forecast heute", "kWh"),
		numState("learning.pv_bias.frozen_tomorrow_kwh", "PV eingefrorener Forecast morgen", "kWh"),
		strState("learning.pv_bias.frozen_source", "PV-Bias Freeze-Quelle"),
		strState("learning.pv_bias.freeze_status", "PV-Bias Freeze-Status", "waiting"),
		strState("learning.pv_bias.freeze_reason", "PV-Bias Freeze-Hinweis"),
	];

	await ensureStates(host, defs);
}

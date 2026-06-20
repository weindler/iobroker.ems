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

export async function ensurePriceForecastLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.price_forecast", "EMS-Light Learning Price Forecast");

	const defs: StateDef[] = [
		strState("learning.price_forecast.status", "Price-Forecast-Learning Status", "not_initialized"),
		strState("learning.price_forecast.health", "Price-Forecast-Learning Health", "error"),
		strState("learning.price_forecast.last_run", "Price-Forecast-Learning letzter Lauf (ISO)"),
		numState("learning.price_forecast.forecast_confidence", "Price-Forecast Confidence", "%"),
		numState("learning.price_forecast.sample_days", "Price-Forecast gültige Tage"),
		numState("learning.price_forecast.coverage_pct", "Price-Forecast Abdeckung", "%"),
		numState("learning.price_forecast.missing_days", "Price-Forecast fehlende Tage"),
		numState("learning.price_forecast.forecast_accuracy_7d", "Price-Forecast Accuracy 7d", "%"),
		numState("learning.price_forecast.forecast_accuracy_30d", "Price-Forecast Accuracy 30d", "%"),
		numState("learning.price_forecast.forecast_accuracy_90d", "Price-Forecast Accuracy 90d", "%"),
		numState("learning.price_forecast.avg_error_ct_7d", "Price-Forecast Ø Fehler 7d", "ct/kWh"),
		numState("learning.price_forecast.avg_error_ct_30d", "Price-Forecast Ø Fehler 30d", "ct/kWh"),
		numState("learning.price_forecast.avg_error_ct_90d", "Price-Forecast Ø Fehler 90d", "ct/kWh"),
		strState("learning.price_forecast.stability", "Price-Forecast Stabilität", "unknown"),
		strState("learning.price_forecast.forecast_source", "Price-Forecast Quelle"),
		strState("learning.price_forecast.actual_source", "Price-Forecast Ist-Quelle"),
		strState("learning.price_forecast.error", "Price-Forecast Fehler"),
		strState("learning.price_forecast.frozen_at_ts", "Price-Forecast Morgen eingefroren um (ISO)"),
		strState("learning.price_forecast.frozen_target_date", "Price-Forecast Morgen Freeze-Zieldatum"),
		strState("learning.price_forecast.freeze_status", "Price-Forecast Morgen Freeze-Status", "waiting"),
		strState("learning.price_forecast.freeze_reason", "Price-Forecast Morgen Freeze-Grund"),
		strState("learning.price_forecast.frozen_today_at_ts", "Price-Forecast Heute eingefroren um (ISO)"),
		strState("learning.price_forecast.frozen_today_target_date", "Price-Forecast Heute Freeze-Zieldatum"),
		strState("learning.price_forecast.freeze_today_status", "Price-Forecast Heute Freeze-Status", "waiting"),
		strState("learning.price_forecast.freeze_today_reason", "Price-Forecast Heute Freeze-Grund"),
		strState("learning.price_forecast.freeze_time", "Price-Forecast Freeze-Zeiten (heute/morgen)"),
		strState("learning.price_forecast.today_freeze_time", "Price-Forecast Heute Freeze (HH:MM)"),
		strState("learning.price_forecast.tomorrow_freeze_time", "Price-Forecast Morgen Freeze (HH:MM)"),
	];

	await ensureStates(host, defs);
}

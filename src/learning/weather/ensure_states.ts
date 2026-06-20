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

export async function ensureWeatherLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.weather", "EMS-Light Learning Weather");

	const defs: StateDef[] = [
		strState("learning.weather.status", "Weather-Learning Status", "not_initialized"),
		strState("learning.weather.health", "Weather-Learning Health", "error"),
		strState("learning.weather.last_update", "Weather-Learning letztes Update (ISO)"),
		numState("learning.weather.temp_bias_c", "Wetter Temp-Bias", "°C"),
		numState("learning.weather.cloud_bias_pct", "Wetter Wolken-Bias", "%"),
		numState("learning.weather.rain_bias_mm", "Wetter Regen-Bias", "mm"),
		numState("learning.weather.wind_bias_ms", "Wetter Wind-Bias", "m/s"),
		numState("learning.weather.confidence_pct", "Weather-Learning Confidence", "%"),
		numState("learning.weather.sample_days_7d", "Weather-Learning gültige Tage 7d"),
		numState("learning.weather.sample_days_30d", "Weather-Learning gültige Tage 30d"),
		strState("learning.weather.valid_fields", "Weather-Learning valide Felder"),
		strState("learning.weather.missing_fields", "Weather-Learning fehlende Felder"),
		strState("learning.weather.quality_level", "Weather-Learning Qualität", "none"),
		strState("learning.weather.forecast_source", "Weather-Learning Forecast-Quelle"),
		strState("learning.weather.actual_source", "Weather-Learning Ist-Quelle"),
		strState("learning.weather.summary_yesterday", "Weather-Learning Zusammenfassung gestern"),
		strState("learning.weather.error", "Weather-Learning Fehler"),
	];

	await ensureStates(host, defs);
}

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
		numState("learning.weather.confidence_pct", "Weather-Learning Confidence", "%"),
		numState("learning.weather.sample_days_30d", "Weather-Learning gültige Tage 30d"),
		strState("learning.weather.error", "Weather-Learning Fehler"),
	];

	await ensureStates(host, defs);
}

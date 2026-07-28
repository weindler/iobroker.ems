import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../../ems_light/state_util";
import { WEATHER_HORIZON_DAY_INDEXES } from "./constants";

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

export function weatherHorizonDayStatePrefix(dayIndex: number): string {
	return `learning.weather.horizon.day${dayIndex}`;
}

export async function ensureWeatherHorizonStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.weather", "EMS-Light Learning Weather");
	await ensureChannel(host, "learning.weather.horizon", "EMS-Light Weather Horizon (Tag 1–7)");

	const defs: StateDef[] = [
		strState("learning.weather.horizon.status", "Wetter-Horizon Status", "no_data"),
		numState("learning.weather.horizon.days_available", "Wetter-Horizon verfügbare Tage"),
		strState("learning.weather.horizon.last_update", "Wetter-Horizon letztes Update (ISO)"),
		numState("learning.weather.horizon.min_bias_c", "Wetter-Horizon Min-Bias (Ist−Forecast)", "°C"),
		numState("learning.weather.horizon.max_bias_c", "Wetter-Horizon Max-Bias (Ist−Forecast)", "°C"),
		strState("learning.weather.horizon.bias_source", "Wetter-Horizon Bias-Quelle", "none"),
		strState("learning.weather.horizon.freeze_date", "Wetter-Horizon Freeze-Datum (Tag1 Forecast)"),
		numState("learning.weather.horizon.freeze_min_temp_c", "Freeze Tag1 Forecast Min", "°C"),
		numState("learning.weather.horizon.freeze_max_temp_c", "Freeze Tag1 Forecast Max", "°C"),
		strState("learning.weather.horizon.observed_date", "Beobachtetes Ist-Datum (Live)"),
		numState("learning.weather.horizon.observed_min_temp_c", "Beobachtetes Ist Min heute", "°C"),
		numState("learning.weather.horizon.observed_max_temp_c", "Beobachtetes Ist Max heute", "°C"),
	];

	for (const day of WEATHER_HORIZON_DAY_INDEXES) {
		const prefix = weatherHorizonDayStatePrefix(day);
		const label =
			day === 1 ? "heute" : day === 2 ? "morgen" : `Tag ${day}`;
		defs.push(
			numState(`${prefix}.raw_min_temp_c`, `Wetter-Horizon ${label} Roh Min °C`, "°C"),
			numState(`${prefix}.raw_max_temp_c`, `Wetter-Horizon ${label} Roh Max °C`, "°C"),
			numState(`${prefix}.min_temp_c`, `Wetter-Horizon ${label} korr. Min °C`, "°C"),
			numState(`${prefix}.max_temp_c`, `Wetter-Horizon ${label} korr. Max °C`, "°C"),
			strState(`${prefix}.quality`, `Wetter-Horizon ${label} Qualität`, "missing"),
		);
	}

	await ensureStates(host, defs);
}

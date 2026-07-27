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
	await ensureChannel(host, "learning.weather.horizon", "EMS-Light Weather Horizon (Tag 3–7)");

	const defs: StateDef[] = [
		strState("learning.weather.horizon.status", "Wetter-Horizon Status", "no_data"),
		numState("learning.weather.horizon.days_available", "Wetter-Horizon verfügbare Tage"),
		strState("learning.weather.horizon.last_update", "Wetter-Horizon letztes Update (ISO)"),
	];

	for (const day of WEATHER_HORIZON_DAY_INDEXES) {
		const prefix = weatherHorizonDayStatePrefix(day);
		defs.push(
			numState(`${prefix}.min_temp_c`, `Wetter-Horizon Tag ${day} Min °C`, "°C"),
			numState(`${prefix}.max_temp_c`, `Wetter-Horizon Tag ${day} Max °C`, "°C"),
			strState(`${prefix}.quality`, `Wetter-Horizon Tag ${day} Qualität`, "missing"),
		);
	}

	await ensureStates(host, defs);
}

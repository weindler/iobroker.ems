import {
	WEATHER_HORIZON_DAY_INDEXES,
	type WeatherHorizonDayIndex,
} from "./constants";

export type WeatherHorizonDayQuality = "valid" | "degraded" | "missing";

export interface WeatherHorizonDayMapping {
	dayIndex: WeatherHorizonDayIndex;
	minTempStateId: string;
	maxTempStateId: string;
}

export interface WeatherHorizonConfig {
	enabled: boolean;
	days: WeatherHorizonDayMapping[];
}

function strField(config: Record<string, unknown>, key: string): string {
	const v = config[key];
	return typeof v === "string" ? v.trim() : "";
}

function boolField(config: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
	const v = config[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
		if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	}
	return defaultVal;
}

/** Admin keys: learning_weather_horizon_day{N}_{min|max}_temp_state (N = 1…7). */
export function weatherHorizonConfigFromAdapter(config: unknown): WeatherHorizonConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const days: WeatherHorizonDayMapping[] = [];
	for (const dayIndex of WEATHER_HORIZON_DAY_INDEXES) {
		days.push({
			dayIndex,
			minTempStateId: strField(c, `learning_weather_horizon_day${dayIndex}_min_temp_state`),
			maxTempStateId: strField(c, `learning_weather_horizon_day${dayIndex}_max_temp_state`),
		});
	}
	return {
		enabled: boolField(c, "learning_weather_horizon_enabled", true),
		days,
	};
}

export function weatherHorizonHasAnyMapping(cfg: WeatherHorizonConfig): boolean {
	return cfg.days.some((d) => d.minTempStateId || d.maxTempStateId);
}

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WeatherPersistDay } from "./types";

export async function writeWeatherDayPersist(baseDir: string, payload: WeatherPersistDay): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const filePath = path.join(baseDir, `${payload.date}.json`);
	await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function dayResultToPersist(
	day: {
		dateKey: string;
		validHours: number;
		metrics: Partial<
			Record<
				string,
				{
					bias: number | null;
				}
			>
		>;
		missingForecast: string[];
		missingActual: string[];
		confidence: string;
		health: string;
	},
	forecastSource: string,
	actualSource: string,
): WeatherPersistDay {
	return {
		date: day.dateKey,
		module: "learning.weather.v1",
		forecast_source: forecastSource,
		actual_source: actualSource,
		valid_hours: day.validHours,
		metrics: {
			temp_bias_c: day.metrics.temp?.bias ?? null,
			cloud_bias_pct: day.metrics.cloud?.bias ?? null,
			rain_bias_mm: day.metrics.rain?.bias ?? null,
			wind_bias_kmh: day.metrics.wind?.bias ?? null,
		},
		missing: {
			forecast: day.missingForecast,
			actual: day.missingActual,
		},
		confidence: day.confidence as WeatherPersistDay["confidence"],
		health: day.health as WeatherPersistDay["health"],
	};
}

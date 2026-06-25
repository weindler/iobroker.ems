import { sourceLabelFromStateId, weatherConfigFromAdapter, weatherConfigReady } from "./config";
import { fetchWeatherDayResults } from "./history";
import { computeWeatherLearning, errorResult } from "./math";
import { dayResultToPersist, writeWeatherDayPersist } from "./persist";
import type { WeatherComputeResult } from "./types";
import type { WeatherMetricKey } from "./constants";

export type WeatherRunHost = {
	config: unknown;
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

async function setNumIfValid(host: WeatherRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
	}
}

function joinFields(keys: WeatherMetricKey[]): string {
	return keys.join(",");
}

async function writeWeatherResult(host: WeatherRunHost, result: WeatherComputeResult): Promise<void> {
	await setNumIfValid(host, "learning.weather.temp_bias_c", result.tempBiasC);
	await setNumIfValid(host, "learning.weather.cloud_bias_pct", result.cloudBiasPct);
	await setNumIfValid(host, "learning.weather.rain_bias_mm", result.rainBiasMm);
	await setNumIfValid(host, "learning.weather.wind_bias_kmh", result.windBiasKmh);
	await setNumIfValid(host, "learning.weather.confidence_pct", result.confidencePct);
	await setNumIfValid(host, "learning.weather.sample_days_7d", result.sampleDays7d);
	await setNumIfValid(host, "learning.weather.sample_days_30d", result.sampleDays30d);
	await host.setStateAsync("learning.weather.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.weather.health", { val: result.health, ack: true });
	await host.setStateAsync("learning.weather.quality_level", { val: result.qualityLevel, ack: true });
	await host.setStateAsync("learning.weather.valid_fields", { val: joinFields(result.validFields), ack: true });
	await host.setStateAsync("learning.weather.missing_fields", {
		val: joinFields(result.missingFields),
		ack: true,
	});
	await host.setStateAsync("learning.weather.forecast_source", { val: result.forecastSource, ack: true });
	await host.setStateAsync("learning.weather.actual_source", { val: result.actualSource, ack: true });
	await host.setStateAsync("learning.weather.summary_yesterday", { val: result.summaryYesterday, ack: true });
	await host.setStateAsync("learning.weather.error", { val: result.error, ack: true });
	await host.setStateAsync("learning.weather.last_update", {
		val: new Date().toISOString(),
		ack: true,
	});
}

function resolveSources(cfg: ReturnType<typeof weatherConfigFromAdapter>): {
	forecastSource: string;
	actualSource: string;
} {
	const first = Object.values(cfg.metrics)[0];
	if (!first) {
		return { forecastSource: "", actualSource: "" };
	}
	return {
		forecastSource: sourceLabelFromStateId(first.forecastStateId),
		actualSource: sourceLabelFromStateId(first.actualStateId),
	};
}

export async function runWeatherLearning(host: WeatherRunHost): Promise<void> {
	const cfg = weatherConfigFromAdapter(host.config);
	const { forecastSource, actualSource } = resolveSources(cfg);

	if (!cfg.enabled) {
		await host.setStateAsync("learning.weather.status", { val: "disabled", ack: true });
		await host.setStateAsync("learning.weather.error", {
			val: "Weather Learning in Admin deaktiviert.",
			ack: true,
		});
		return;
	}

	if (!weatherConfigReady(cfg)) {
		const result = errorResult(
			forecastSource,
			actualSource,
			"Mindestens ein Forecast-/Ist-Mapping in Admin konfigurieren.",
		);
		result.status = "missing_mapping";
		await writeWeatherResult(host, result);
		return;
	}

	try {
		const dayResults = await fetchWeatherDayResults(host, cfg.metrics, 30);
		const yesterday = dayResults.find((d) => d.dayOffset === 1) ?? null;
		const result = computeWeatherLearning(
			dayResults,
			cfg.metrics,
			yesterday,
			forecastSource,
			actualSource,
		);
		await writeWeatherResult(host, result);

		if (yesterday && host.getAbsolutePath) {
			const baseDir = host.getAbsolutePath("learning/weather");
			await writeWeatherDayPersist(baseDir, dayResultToPersist(yesterday, forecastSource, actualSource));
		}

		host.log.info(
			`Weather-Learning: status=${result.status} health=${result.health} confidence=${result.confidence} samples7d=${result.sampleDays7d}`,
		);

		if (result.missingFields.length > 0) {
			const recent = dayResults.filter((d) => d.dayOffset <= 6);
			for (const key of result.missingFields) {
				const noForecast = recent.filter((d) => d.missingForecast.includes(key)).length;
				const noActual = recent.filter((d) => d.missingActual.includes(key)).length;
				const fc = cfg.metrics[key]?.forecastStateId ?? "—";
				const act = cfg.metrics[key]?.actualStateId ?? "—";
				const side =
					noForecast >= noActual
						? `Forecast fehlt (${fc}, ${noForecast}/7 Tage ohne Stundenwerte)`
						: `Ist fehlt (${act}, ${noActual}/7 Tage ohne Stundenwerte)`;
				host.log.warn(`Weather-Learning: '${key}' ohne Bias — ${side}; history.0 auf dem State prüfen.`);
			}
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Weather-Learning: ${msg}`);
		const result = errorResult(forecastSource, actualSource, msg);
		await writeWeatherResult(host, result);
	}
}

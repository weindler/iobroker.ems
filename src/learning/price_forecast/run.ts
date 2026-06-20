import {
	priceForecastConfigFromAdapter,
	priceForecastConfigReady,
	sourceLabelFromStateId,
} from "./config";
import { buildMatchedPairs, runPriceForecastFreeze } from "./compare";
import {
	computePriceForecastLearning,
	disabledResult,
	errorResult,
	missingForecastResult,
} from "./math";
import { writePriceForecastPersist } from "./persist";
import type { PriceForecastResult } from "./types";

export type PriceForecastRunHost = {
	config: unknown;
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		error: (msg: string) => void;
		debug?: (msg: string) => void;
	};
};

async function setNumIfValid(host: PriceForecastRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
	}
}

async function writeResult(
	host: PriceForecastRunHost,
	result: PriceForecastResult,
	lastRun: string,
	freezeTime: string,
): Promise<void> {
	await setNumIfValid(host, "learning.price_forecast.forecast_confidence", result.forecastConfidence);
	await setNumIfValid(host, "learning.price_forecast.sample_days", result.sampleDays);
	await setNumIfValid(host, "learning.price_forecast.coverage_pct", result.coveragePct);
	await setNumIfValid(host, "learning.price_forecast.missing_days", result.missingDays);
	await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_7d", result.forecastAccuracy7d);
	await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_30d", result.forecastAccuracy30d);
	await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_90d", result.forecastAccuracy90d);
	await setNumIfValid(host, "learning.price_forecast.avg_error_ct_7d", result.avgErrorCt7d);
	await setNumIfValid(host, "learning.price_forecast.avg_error_ct_30d", result.avgErrorCt30d);
	await setNumIfValid(host, "learning.price_forecast.avg_error_ct_90d", result.avgErrorCt90d);
	await host.setStateAsync("learning.price_forecast.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.price_forecast.health", { val: result.health, ack: true });
	await host.setStateAsync("learning.price_forecast.stability", { val: result.stability, ack: true });
	await host.setStateAsync("learning.price_forecast.forecast_source", {
		val: result.forecastSource,
		ack: true,
	});
	await host.setStateAsync("learning.price_forecast.actual_source", { val: result.actualSource, ack: true });
	await host.setStateAsync("learning.price_forecast.error", { val: result.error, ack: true });
	await host.setStateAsync("learning.price_forecast.last_run", { val: lastRun, ack: true });
	await host.setStateAsync("learning.price_forecast.freeze_time", { val: freezeTime, ack: true });
}

export async function runPriceForecastLearning(host: PriceForecastRunHost): Promise<void> {
	const cfg = priceForecastConfigFromAdapter(host.config);
	const lastRun = new Date().toISOString();

	if (!cfg.enabled) {
		await writeResult(host, disabledResult(), lastRun, cfg.freezeTime);
		return;
	}

	if (!priceForecastConfigReady(cfg)) {
		await writeResult(host, missingForecastResult(), lastRun, cfg.freezeTime);
		return;
	}

	const forecastSource = sourceLabelFromStateId(cfg.tomorrowJsonStateId);
	const actualSource = sourceLabelFromStateId(cfg.actualStateId);

	try {
		await runPriceForecastFreeze(host, cfg);
		const pairs = await buildMatchedPairs(host, cfg);
		const result = computePriceForecastLearning(
			pairs,
			cfg.lookbackDays,
			forecastSource,
			actualSource,
			new Date(),
		);
		await writeResult(host, result, lastRun, cfg.freezeTime);

		if (host.getAbsolutePath) {
			const baseDir = host.getAbsolutePath("learning/price_forecast");
			await writePriceForecastPersist(baseDir, result, lastRun);
		}

		host.log.info(
			`Price Forecast Learning completed: status=${result.status} confidence=${result.forecastConfidence}`,
		);

		if (host.log.debug) {
			host.log.debug(
				`Price Forecast: pairs=${pairs.length} accuracy7d=${result.forecastAccuracy7d} avgError7d=${result.avgErrorCt7d}`,
			);
		}

		if (result.status === "insufficient_data") {
			host.log.warn(
				`Price Forecast Learning: ungenügende Daten (sample_days=${result.sampleDays}, coverage=${result.coveragePct}%)`,
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Price Forecast Learning: ${msg}`);
		await writeResult(host, errorResult(forecastSource, actualSource, msg), lastRun, cfg.freezeTime);
	}
}

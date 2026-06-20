import {
	priceLearningConfigFromAdapter,
	priceLearningConfigReady,
	sourceLabelFromStateId,
} from "./config";
import { fetchPriceSamples, summarizeDays } from "./history";
import {
	computePriceLearning,
	disabledResult,
	errorResult,
	missingMappingResult,
} from "./math";
import { writePriceLearningPersist } from "./persist";
import type { PriceLearningResult } from "./types";

export type PriceLearningRunHost = {
	config: unknown;
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
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

async function setNumIfValid(host: PriceLearningRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: Math.round(value * 10000) / 10000, ack: true });
	}
}

async function writePriceLearningResult(
	host: PriceLearningRunHost,
	result: PriceLearningResult,
	lastRun: string,
): Promise<void> {
	await setNumIfValid(host, "learning.price_learning.confidence", result.confidence);
	await setNumIfValid(host, "learning.price_learning.sample_days", result.sampleDays);
	await setNumIfValid(host, "learning.price_learning.coverage_pct", result.coveragePct);
	await setNumIfValid(host, "learning.price_learning.missing_days", result.missingDays);
	await setNumIfValid(host, "learning.price_learning.avg_price_7d", result.avgPrice7d);
	await setNumIfValid(host, "learning.price_learning.avg_price_30d", result.avgPrice30d);
	await setNumIfValid(host, "learning.price_learning.avg_price_90d", result.avgPrice90d);
	await setNumIfValid(host, "learning.price_learning.volatility_30d", result.volatility30d);
	await host.setStateAsync("learning.price_learning.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.price_learning.health", { val: result.health, ack: true });
	await host.setStateAsync("learning.price_learning.cheap_hours", {
		val: JSON.stringify(result.cheapHours),
		ack: true,
	});
	await host.setStateAsync("learning.price_learning.expensive_hours", {
		val: JSON.stringify(result.expensiveHours),
		ack: true,
	});
	await host.setStateAsync("learning.price_learning.price_source", { val: result.priceSource, ack: true });
	await host.setStateAsync("learning.price_learning.error", { val: result.error, ack: true });
	await host.setStateAsync("learning.price_learning.last_run", { val: lastRun, ack: true });
}

export async function runPriceLearning(host: PriceLearningRunHost): Promise<void> {
	const cfg = priceLearningConfigFromAdapter(host.config);
	const lastRun = new Date().toISOString();

	if (!cfg.enabled) {
		const result = disabledResult();
		await writePriceLearningResult(host, result, lastRun);
		return;
	}

	if (!priceLearningConfigReady(cfg)) {
		const result = missingMappingResult();
		await writePriceLearningResult(host, result, lastRun);
		return;
	}

	const priceSource = sourceLabelFromStateId(cfg.priceStateId);

	try {
		const { samples } = await fetchPriceSamples(host, cfg.priceStateId, cfg.lookbackDays);
		const daySummaries = summarizeDays(samples, cfg.lookbackDays);
		const result = computePriceLearning(samples, daySummaries, cfg.lookbackDays, priceSource);
		await writePriceLearningResult(host, result, lastRun);

		if (host.getAbsolutePath) {
			const baseDir = host.getAbsolutePath("learning/price_learning");
			await writePriceLearningPersist(baseDir, result, lastRun);
		}

		host.log.info(`Price Learning completed: status=${result.status} confidence=${result.confidence}`);

		if (host.log.debug) {
			host.log.debug(
				`Price Learning: samples=${samples.length} avg7d=${result.avgPrice7d} avg30d=${result.avgPrice30d} volatility30d=${result.volatility30d}`,
			);
		}

		if (result.status === "insufficient_data") {
			host.log.warn(
				`Price Learning: ungenügende Historie (sample_days=${result.sampleDays}, coverage=${result.coveragePct}%)`,
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Price Learning: ${msg}`);
		const result = errorResult(priceSource, msg);
		await writePriceLearningResult(host, result, lastRun);
	}
}

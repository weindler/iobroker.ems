import { sourceLabelFromStateId, houseLoadConfigFromAdapter } from "./config";
import { MIN_DAY_HOURS } from "./constants";
import { distinctSampleDays, distinctSampleDaysWithMinHours, fetchHouseLoadSamples } from "./history";
import { resolveHouseLoadPowerStateId } from "./mapping";
import {
	computeHouseLoadLearning,
	disabledResult,
	errorResult,
	noSourceResult,
} from "./math";
import { readHouseLoadPersist, writeHouseLoadPersist } from "./persist";
import type { HouseLoadComputeResult } from "./types";

import type { HistoryQueryHost } from "../history_query";

export type HouseLoadRunHost = HistoryQueryHost & {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
};

const JSON_STATE_LIMIT = 12_000;

function truncateJson(obj: unknown): string {
	const raw = JSON.stringify(obj);
	if (raw.length <= JSON_STATE_LIMIT) {
		return raw;
	}
	return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}

async function setNumIfValid(host: HouseLoadRunHost, id: string, value: number | null): Promise<void> {
	if (value !== null && Number.isFinite(value)) {
		await host.setStateAsync(id, { val: value, ack: true });
	}
}

async function writeResult(host: HouseLoadRunHost, result: HouseLoadComputeResult): Promise<void> {
	const lastRun = new Date().toISOString();
	await setNumIfValid(host, "learning.house_load.sample_count", result.sampleCount);
	await setNumIfValid(host, "learning.house_load.sample_days", result.sampleDays);
	await setNumIfValid(host, "learning.house_load.confidence", result.confidence);
	await host.setStateAsync("learning.house_load.status", { val: result.status, ack: true });
	await host.setStateAsync("learning.house_load.current_segment", {
		val: result.currentSegment,
		ack: true,
	});
	await host.setStateAsync("learning.house_load.current_season", {
		val: result.currentSeason,
		ack: true,
	});
	await host.setStateAsync("learning.house_load.current_weekday", {
		val: result.currentWeekday,
		ack: true,
	});
	await host.setStateAsync("learning.house_load.current_day_type", {
		val: result.currentDayType,
		ack: true,
	});
	await host.setStateAsync("learning.house_load.profile_json", {
		val: truncateJson(result.profileJson),
		ack: true,
	});
	await host.setStateAsync("learning.house_load.forecast_today_json", {
		val: truncateJson(result.forecastTodayJson),
		ack: true,
	});
	await host.setStateAsync("learning.house_load.forecast_tomorrow_json", {
		val: truncateJson(result.forecastTomorrowJson),
		ack: true,
	});
	await host.setStateAsync("learning.house_load.health_json", {
		val: truncateJson(result.healthJson),
		ack: true,
	});
	await host.setStateAsync("learning.house_load.source_state", {
		val: result.sourceStateId,
		ack: true,
	});
	await host.setStateAsync("learning.house_load.error", { val: result.error, ack: true });
	await host.setStateAsync("learning.house_load.last_update", { val: lastRun, ack: true });
}

export async function runHouseLoadLearning(host: HouseLoadRunHost): Promise<void> {
	const cfg = houseLoadConfigFromAdapter(host.config);
	const now = new Date();

	if (!cfg.enabled) {
		await writeResult(host, disabledResult());
		return;
	}

	const resolved = await resolveHouseLoadPowerStateId(host, cfg.powerStateId);
	if (!resolved.stateId) {
		await writeResult(host, noSourceResult(resolved.stateId, now));
		return;
	}

	let lastPersistAt: string | null = null;
	if (host.getAbsolutePath) {
		const existing = await readHouseLoadPersist(host.getAbsolutePath("learning/house_load"));
		lastPersistAt = existing?.generated_at ?? null;
	}

	try {
		host.log.info(`House-Load-Learning: loading history (${cfg.lookbackDays}d, ${sourceLabelFromStateId(resolved.stateId)})…`);
		const { samples, lastValidTs, stats } = await fetchHouseLoadSamples(
			host,
			resolved.stateId,
			cfg.lookbackDays,
		);
		const sampleDays = distinctSampleDays(samples);
		const sampleDaysMinHours = distinctSampleDaysWithMinHours(samples, MIN_DAY_HOURS);
		const result = computeHouseLoadLearning({
			samples,
			sampleDays,
			lastValidTs,
			sourceStateId: resolved.stateId,
			now,
			lastPersistAt,
		});

		if (host.getAbsolutePath) {
			const baseDir = host.getAbsolutePath("learning/house_load");
			const lastRun = new Date().toISOString();
			await writeHouseLoadPersist(baseDir, result, lastRun);
			result.healthJson.last_persist_at = lastRun;
		}

		await writeResult(host, result);

		host.log.info(
			`House-Load-Learning: status=${result.status} health=${result.healthStatus} samples=${result.sampleCount} days=${result.sampleDays} source=${sourceLabelFromStateId(resolved.stateId)} (history=${stats.rowsTotal} rows → ${stats.hourlySamples} h, valid=${stats.validRows}, skipped=${stats.skippedInvalid + stats.skippedNegative})`,
		);

		if (stats.rowsTotal > 50 && stats.hourlySamples < 10) {
			host.log.warn(
				`House Load Learning: ${stats.rowsTotal} History-Zeilen aber nur ${stats.hourlySamples} Stunden-Samples (invalid=${stats.skippedInvalid}, negative=${stats.skippedNegative}) — Einheit/State prüfen`,
			);
		}

		if (sampleDaysMinHours < sampleDays && result.status === "insufficient_data") {
			host.log.info(
				`House Load Learning: ${sampleDays} Kalendertage mit Daten, ${sampleDaysMinHours} mit ≥${MIN_DAY_HOURS}h/Tag`,
			);
		}

		if (result.status === "insufficient_data") {
			host.log.warn(
				`House Load Learning: ungenügende Historie (sample_days=${result.sampleDays}, samples=${result.sampleCount})`,
			);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`House Load Learning: ${msg}`);
		await writeResult(host, errorResult(msg, resolved.stateId, now));
	}
}

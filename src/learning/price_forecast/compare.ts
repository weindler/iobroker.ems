import { asNum } from "../../ems_light/state_util";
import { decideForecastFreeze, localDateKey } from "../pv_bias/freeze";
import {
	isValidPriceValue,
	resolvePriceUnit,
	toCtPerKwh,
	toEurPerKwh,
} from "../price_common/units";
import { HISTORY_QUERY_TIMEOUT_MS, MODULE_TAG, MS_PER_HOUR } from "./constants";
import type { PriceForecastConfig } from "./types";
import {
	parseTibberPriceJsonToHourlySlots,
	targetDateForTodayFreeze,
	targetDateForTomorrowFreeze,
} from "./tibber_parse";
import { readForecastFreezeFiles, writeForecastFreezeFile } from "./persist";
import type { MatchedHourPair, PriceForecastFreezeFile } from "./types";
import type { PriceUnit } from "../price_common/units";

export type PriceForecastHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

async function readForeignVal(host: PriceForecastHost, stateId: string): Promise<unknown> {
	if (!stateId) return null;
	const tryRead = async (
		fn?: (id: string) => Promise<ioBroker.State | null | undefined>,
	): Promise<unknown> => {
		if (!fn) return null;
		try {
			const st = await fn.call(host, stateId);
			return st?.val ?? null;
		} catch {
			return null;
		}
	};
	const foreign = await tryRead(host.getForeignStateAsync);
	if (foreign !== null && foreign !== undefined) return foreign;
	return tryRead(host.getStateAsync);
}

async function withHistoryTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	let timer: NodeJS.Timeout | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), timeoutMs);
			}),
		]);
	} catch {
		return null;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function fetchActualCtAtHour(
	host: PriceForecastHost,
	stateId: string,
	unit: PriceUnit,
	hourStartMs: number,
): Promise<number | null> {
	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start: hourStartMs,
			end: hourStartMs + MS_PER_HOUR,
			aggregate: "onchange",
			ignoreNull: true,
			count: 20,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		HISTORY_QUERY_TIMEOUT_MS,
	);
	if (!res?.result || !Array.isArray(res.result) || res.result.length === 0) {
		return null;
	}
	let best: { ts: number; val: number } | null = null;
	for (const row of res.result) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const raw = asNum(row?.val);
		if (ts === null || !isValidPriceValue(raw, unit)) continue;
		if (!best || Math.abs(ts - hourStartMs) < Math.abs(best.ts - hourStartMs)) {
			best = { ts, val: raw };
		}
	}
	if (!best) return null;
	return Math.round(toCtPerKwh(toEurPerKwh(best.val, unit)) * 1000) / 1000;
}

type FreezeTrack = {
	label: string;
	jsonStateId: string;
	freezeTime: string;
	frozenAtStateId: string;
	targetDateStateId: string;
	statusStateId: string;
	reasonStateId: string;
	targetDate: (now: Date) => string;
};

async function runFreezeTrack(
	host: PriceForecastHost,
	cfg: PriceForecastConfig,
	track: FreezeTrack,
): Promise<boolean> {
	if (!track.jsonStateId || !host.getAbsolutePath) {
		return false;
	}

	const now = new Date();
	const frozenAtSt = await host.getStateAsync(track.frozenAtStateId);
	const frozenAtTs = typeof frozenAtSt?.val === "string" ? frozenAtSt.val : null;
	const decision = decideForecastFreeze(now, cfg.freezeEnabled, track.freezeTime, frozenAtTs);

	await host.setStateAsync(track.statusStateId, { val: decision.status, ack: true });
	await host.setStateAsync(track.reasonStateId, { val: decision.reason, ack: true });

	if (!decision.shouldFreeze) {
		return false;
	}

	const raw = await readForeignVal(host, track.jsonStateId);
	const targetDate = track.targetDate(now);
	const slots = parseTibberPriceJsonToHourlySlots(raw, targetDate);

	if (slots.length === 0) {
		host.log.warn(`Price Forecast Freeze (${track.label}): keine Slots für ${targetDate}`);
		await host.setStateAsync(track.statusStateId, { val: "error", ack: true });
		await host.setStateAsync(track.reasonStateId, {
			val: `Keine Forecast-Slots für ${targetDate} (${track.label}).`,
			ack: true,
		});
		return false;
	}

	const baseDir = host.getAbsolutePath("learning/price_forecast");
	const payload: PriceForecastFreezeFile = {
		module: MODULE_TAG,
		frozen_at: now.toISOString(),
		freeze_date: localDateKey(now),
		target_date: targetDate,
		forecast_source: track.jsonStateId,
		slots,
	};
	await writeForecastFreezeFile(baseDir, payload);

	await host.setStateAsync(track.frozenAtStateId, { val: now.toISOString(), ack: true });
	await host.setStateAsync(track.targetDateStateId, { val: targetDate, ack: true });
	await host.setStateAsync(track.statusStateId, { val: "ready", ack: true });
	await host.setStateAsync(track.reasonStateId, {
		val: `${track.label}: Forecast für ${targetDate} eingefroren (${slots.length}h).`,
		ack: true,
	});
	host.log.info(`Price Forecast Freeze (${track.label}): ${targetDate} ${slots.length} Stunden`);
	return true;
}

export async function runPriceForecastFreeze(
	host: PriceForecastHost,
	cfg: PriceForecastConfig,
): Promise<void> {
	if (!cfg.freezeEnabled || !host.getAbsolutePath) {
		return;
	}

	if (cfg.todayFreezeEnabled && cfg.todayJsonStateId) {
		await runFreezeTrack(host, cfg, {
			label: "heute",
			jsonStateId: cfg.todayJsonStateId,
			freezeTime: cfg.todayFreezeTime,
			frozenAtStateId: "learning.price_forecast.frozen_today_at_ts",
			targetDateStateId: "learning.price_forecast.frozen_today_target_date",
			statusStateId: "learning.price_forecast.freeze_today_status",
			reasonStateId: "learning.price_forecast.freeze_today_reason",
			targetDate: targetDateForTodayFreeze,
		});
	}

	if (cfg.tomorrowJsonStateId) {
		await runFreezeTrack(host, cfg, {
			label: "morgen",
			jsonStateId: cfg.tomorrowJsonStateId,
			freezeTime: cfg.tomorrowFreezeTime,
			frozenAtStateId: "learning.price_forecast.frozen_at_ts",
			targetDateStateId: "learning.price_forecast.frozen_target_date",
			statusStateId: "learning.price_forecast.freeze_status",
			reasonStateId: "learning.price_forecast.freeze_reason",
			targetDate: targetDateForTomorrowFreeze,
		});
	}
}

export async function buildMatchedPairs(
	host: PriceForecastHost,
	cfg: PriceForecastConfig,
): Promise<MatchedHourPair[]> {
	if (!host.getAbsolutePath) {
		return [];
	}
	const baseDir = host.getAbsolutePath("learning/price_forecast");
	const freezeFiles = await readForecastFreezeFiles(baseDir, cfg.lookbackDays);
	const unit = await resolvePriceUnit(host, cfg.actualStateId);

	const nowMs = Date.now();
	const pairs: MatchedHourPair[] = [];

	for (const file of freezeFiles) {
		for (const slot of file.slots) {
			if (slot.hourStartMs + MS_PER_HOUR > nowMs) {
				continue;
			}
			const actualCt = await fetchActualCtAtHour(
				host,
				cfg.actualStateId,
				unit,
				slot.hourStartMs,
			);
			if (actualCt === null) continue;
			const absErrorCt = Math.abs(slot.forecastCtPerKwh - actualCt);
			pairs.push({
				targetDate: file.target_date,
				hourStartMs: slot.hourStartMs,
				forecastCt: slot.forecastCtPerKwh,
				actualCt,
				absErrorCt: Math.round(absErrorCt * 1000) / 1000,
			});
		}
	}
	return pairs;
}

import { sourceLabelFromStateId, houseLoadConfigFromAdapter } from "./config";
import { MIN_DAY_HOURS, MS_PER_HOUR } from "./constants";
import { distinctSampleDays, distinctSampleDaysWithMinHours, fetchHouseLoadSamples, type HouseLoadHistoryStats } from "./history";
import { resolveHouseLoadPowerStateId } from "./mapping";
import {
	computeHouseLoadLearning,
	disabledResult,
	errorResult,
	noSourceResult,
} from "./math";
import { readHouseLoadPersist, writeHouseLoadPersist } from "./persist";
import type { HouseLoadComputeResult } from "./types";
import {
	applyFlexDecompositionToSamples,
	type KnownFlexibleEmsLoadsW,
} from "./decompose";
import { IMMERSION_RUNTIME_STATES } from "../../addons/immersion_heater/runtime/types";
import { acUnitRuntimeStates } from "../../addons/air_conditioning/runtime/ensure_states";
import { AC_UNIT_COUNT } from "../../addons/air_conditioning/constants";
import { BAT } from "../../addons/battery/ensure_states";
import { asNum } from "../../ems_light/state_util";

import type { HistoryQueryHost } from "../history_query";

export type HouseLoadRunHost = HistoryQueryHost & {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void;
		debug?: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
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

async function writeResult(
	host: HouseLoadRunHost,
	result: HouseLoadComputeResult,
	historyMode?: HouseLoadHistoryStats["historySource"],
): Promise<void> {
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
	await host.setStateAsync("learning.house_load.forecast_horizon_json", {
		val: truncateJson(result.forecastHorizonJson),
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
	await host.setStateAsync("learning.house_load.history_mode", {
		val: historyMode ?? "",
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
		host.log.debug?.(`House-Load-Learning: loading history (${cfg.lookbackDays}d, ${sourceLabelFromStateId(resolved.stateId)})…`);
		const { samples: rawSamples, lastValidTs, stats } = await fetchHouseLoadSamples(
			host,
			resolved.stateId,
			cfg.lookbackDays,
		);
		/*
		 * Flex-Dekomposition: bekannte EMS-Istwerte vom aktuellen Stundenfenster
		 * (keine erfundenen Historien). Ältere Samples bleiben unverändert, bis
		 * stundenweise Flex-Historie verfügbar ist.
		 */
		const flexMap = new Map<number, KnownFlexibleEmsLoadsW>();
		const currentHour = Math.floor(now.getTime() / MS_PER_HOUR) * MS_PER_HOUR;
		/*
		 * Nur belastbare Istwerte abziehen. Aktiv ohne Leistungstelemetrie → null
		 * (quality partial). Inaktiv/unmapped → weglassen (nicht als missing markieren).
		 */
		const climateUnitsW: Array<number | null | undefined> = [];
		for (let u = 1; u <= AC_UNIT_COUNT; u++) {
			const ids = acUnitRuntimeStates(u);
			const running = (await host.getStateAsync(ids.running))?.val === true;
			const est = asNum((await host.getStateAsync(ids.estimatedPowerW))?.val);
			if (!running) climateUnitsW.push(undefined);
			else climateUnitsW.push(est != null && est >= 0 ? est : null);
		}
		const ihMeas = asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.measuredPowerW))?.val);
		const ihCmd = asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.commandedPowerW))?.val);
		const ihStage = asNum((await host.getStateAsync(IMMERSION_RUNTIME_STATES.feedbackStage))?.val) ?? 0;
		const ihActive = ihStage > 0 || (ihMeas != null && ihMeas > 0);
		const wbCharge = asNum((await host.getStateAsync("live.wallbox.charge_power_w"))?.val);
		const batCharge = asNum((await host.getStateAsync(BAT.telemetry.chargingPowerW))?.val);
		const flex: KnownFlexibleEmsLoadsW = {
			climateUnitsW,
			immersionHeaterW: ihMeas != null && ihMeas >= 0
				? ihMeas
				: ihActive
					? ihCmd != null && ihCmd >= 0
						? ihCmd
						: null
					: undefined,
		};
		if (wbCharge != null && wbCharge >= 0) flex.wallboxChargeW = wbCharge;
		if (batCharge != null && batCharge >= 0) flex.batteryChargeW = batCharge;
		flexMap.set(currentHour, flex);
		const decomp = applyFlexDecompositionToSamples(rawSamples, flexMap);
		const samples = decomp.samples.map((s, i) => ({
			...rawSamples[i]!,
			powerW: s.powerW,
		}));
		if (decomp.decomposedCount > 0) {
			host.log.debug?.(
				`House-Load-Learning: Flex-Dekomposition auf ${decomp.decomposedCount} Samples (partial=${decomp.partialCount})`,
			);
		}
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

		await writeResult(host, result, stats.historySource);

		host.log.debug?.(
			`House-Load-Learning: status=${result.status} health=${result.healthStatus} samples=${result.sampleCount} days=${result.sampleDays} source=${sourceLabelFromStateId(resolved.stateId)} (history=${stats.historySource}, ${stats.rowsTotal} rows → ${stats.hourlySamples} h, span=${stats.tsSpanHours ?? "?"}h)`,
		);

		if (stats.rowsTotal > 50 && stats.hourlySamples < 10) {
			host.log.warn(
				`House Load Learning: ${stats.rowsTotal} History-Zeilen aber nur ${stats.hourlySamples} Stunden-Samples (invalid=${stats.skippedInvalid}, negative=${stats.skippedNegative}, span=${stats.tsSpanHours ?? "?"}h) — Timestamps/Einheit prüfen`,
			);
		}

		if (sampleDaysMinHours < sampleDays && result.status === "insufficient_data") {
			host.log.debug?.(
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

import { asNum } from "../../ems_light/state_util";
import { fetchRollupDayKwh } from "../energy_daily_rollup/read";
import {
	fetchHistoryRowsInRange,
	HISTORY_CHUNK_TIMEOUT_MS,
	type HistoryQueryHost,
} from "../history_query";
import { localDateKey } from "./dates";
import type { PvBiasDailyPersist } from "./daily_persist";
import type { PvBiasDayPair } from "./types";

export type HistoryHost = HistoryQueryHost & {
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getAbsolutePath?: (category?: string) => string;
};

const MS_PER_DAY = 86_400_000;

/** Lokale Mitternachtsgrenzen für einen Tag (dayOffset 0 = heute). */
export function dayBoundsMs(dayOffset: number): { start: number; end: number } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const start = d.getTime();
	return { start, end: start + MS_PER_DAY };
}

async function readLiveValue(host: HistoryHost, stateId: string): Promise<number | null> {
	return readStateNum(host, stateId);
}

/** Vollqualifizierte ID z. B. alias.0.x — nicht relative ems-eigene IDs wie learning.pv_bias.* */
export function isForeignStateId(stateId: string): boolean {
	return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}

export async function readStateNum(host: HistoryHost, stateId: string): Promise<number | null> {
	if (!stateId) {
		return null;
	}

	const tryRead = async (
		fn?: (id: string) => Promise<ioBroker.State | null | undefined>,
	): Promise<number | null> => {
		if (!fn) {
			return null;
		}
		try {
			const st = await fn.call(host, stateId);
			return asNum(st?.val);
		} catch {
			return null;
		}
	};

	if (isForeignStateId(stateId)) {
		const foreign = await tryRead(host.getForeignStateAsync);
		if (foreign !== null) {
			return foreign;
		}
		return tryRead(host.getStateAsync);
	}

	const own = await tryRead(host.getStateAsync);
	if (own !== null) {
		return own;
	}
	return tryRead(host.getForeignStateAsync);
}

function lastValidValueFromRows(rows: ioBroker.GetHistoryResult): number | null {
	if (!Array.isArray(rows) || rows.length === 0) {
		return null;
	}
	for (let i = rows.length - 1; i >= 0; i--) {
		const n = asNum(rows[i]?.val);
		if (n !== null) {
			return n;
		}
	}
	return null;
}

function firstValidValueFromRows(rows: ioBroker.GetHistoryResult): number | null {
	if (!Array.isArray(rows) || rows.length === 0) {
		return null;
	}
	for (const row of rows) {
		const n = asNum(row?.val);
		if (n !== null) {
			return n;
		}
	}
	return null;
}

/** Letzter gültiger Zahlenwert im Tagesfenster; fehlende Historie → null (nicht 0). */
export async function fetchDayLastValue(
	host: HistoryHost,
	stateId: string,
	startMs: number,
	endMs: number,
): Promise<number | null> {
	if (!stateId) {
		return null;
	}
	const rows = await fetchHistoryRowsInRange(
		host,
		stateId,
		startMs,
		endMs,
		500,
		HISTORY_CHUNK_TIMEOUT_MS,
		"none",
	);
	return lastValidValueFromRows(rows);
}

/** Erster gültiger Wert in einem Zeitfenster (z. B. Forecast um Freeze-Zeit). */
export async function fetchDayValueNearTime(
	host: HistoryHost,
	stateId: string,
	startMs: number,
	endMs: number,
): Promise<number | null> {
	if (!stateId) {
		return null;
	}
	const rows = await fetchHistoryRowsInRange(
		host,
		stateId,
		startMs,
		endMs,
		500,
		HISTORY_CHUNK_TIMEOUT_MS,
		"none",
	);
	return firstValidValueFromRows(rows);
}

export type PvBiasDayPairsResult = {
	pairs: PvBiasDayPair[];
	/** Diagnose: Kalendertage mit gültigem Ist- bzw. Forecast-Wert (vor Paarbildung). */
	actualDays: number;
	forecastDays: number;
	forecastSourceUsed: string;
};

export type FetchPvBiasOptions = {
	maxDays?: number;
	/** Eingefrorener Forecast für heute (Anti-Drift) — überschreibt History nur für dayOffset 0. */
	todayForecastOverride?: number | null;
	/** Tages-Snapshots (Ist 23:58, Forecast beim Freeze) haben Vorrang vor History. */
	dailyPersist?: PvBiasDailyPersist | null;
};

/**
 * Sammelt gültige Tagespaare (Ist vs. Forecast) der letzten 30 Tage.
 * Vergangene Tage: Snapshot-Datei oder letzter Tageswert (kein MAX — DAY_ENERGY resettet morgens).
 * Heute: Live-Ist + eingefrorener Forecast.
 */
export async function fetchPvBiasDayPairs(
	host: HistoryHost,
	actualStateId: string,
	forecastStateId: string,
	options: FetchPvBiasOptions = {},
): Promise<PvBiasDayPairsResult> {
	const maxDays = options.maxDays ?? 30;
	const todayForecastOverride = options.todayForecastOverride ?? null;
	const dailyPersist = options.dailyPersist ?? null;

	const pairs: PvBiasDayPair[] = [];
	let actualDays = 0;
	let forecastDays = 0;

	for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
		const { start, end } = dayBoundsMs(dayOffset);
		const dateKey = localDateKey(new Date(start));
		const stored = dailyPersist?.days[dateKey] ?? null;

		let actualKwh: number | null = null;
		let forecastKwh: number | null = null;

		if (dayOffset === 0) {
			actualKwh = await readLiveValue(host, actualStateId);
			if (todayForecastOverride !== null && todayForecastOverride > 0) {
				forecastKwh = todayForecastOverride;
			} else {
				forecastKwh = await readLiveValue(host, forecastStateId);
			}
		} else {
			actualKwh = stored?.actualKwh ?? null;
			forecastKwh = stored?.forecastKwh ?? null;
			if (actualKwh === null) {
				actualKwh = await fetchRollupDayKwh(host, actualStateId, dateKey);
			}
			if (actualKwh === null) {
				actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
			}
			if (forecastKwh === null) {
				forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);
			}
		}

		if (actualKwh !== null) {
			actualDays++;
		}
		if (forecastKwh !== null && forecastKwh > 0) {
			forecastDays++;
		}

		if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
			continue;
		}
		pairs.push({ dayOffset, actualKwh, forecastKwh });
	}

	return { pairs, actualDays, forecastDays, forecastSourceUsed: forecastStateId };
}

import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsAggregated,
	fetchHistoryRowsInRange,
	HISTORY_CHUNK_TIMEOUT_MS,
	type HistoryQueryHost,
} from "../history_query";
import type { PvBiasDayPair } from "./types";

export type HistoryHost = HistoryQueryHost & {
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
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

function localDateKey(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
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

/** Tagesmaximum via history.0 aggregate — robuster als onChange-Roh-timestamps. */
async function fetchDailyMaxMap(
	host: HistoryHost,
	stateId: string,
	startMs: number,
	endMs: number,
	maxDays: number,
): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	if (!stateId) {
		return map;
	}

	const rows = await fetchHistoryRowsAggregated(
		host,
		stateId,
		startMs,
		endMs,
		maxDays + 5,
		HISTORY_CHUNK_TIMEOUT_MS,
		"max",
		MS_PER_DAY,
	);

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const n = asNum(row?.val);
		if (ts === null || n === null || n <= 0) {
			continue;
		}
		map.set(localDateKey(ts), n);
	}
	return map;
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
};

/**
 * Sammelt gültige Tagespaare (Ist vs. Forecast) der letzten 30 Tage.
 * Forecast kommt aus der **Provider-History** (mehrtägig); der eingefrorene
 * Wert pinnt nur heute, weil der ems-interne Freeze-State keine Tiefe hat.
 */
export async function fetchPvBiasDayPairs(
	host: HistoryHost,
	actualStateId: string,
	forecastStateId: string,
	options: FetchPvBiasOptions = {},
): Promise<PvBiasDayPairsResult> {
	const maxDays = options.maxDays ?? 30;
	const todayForecastOverride = options.todayForecastOverride ?? null;
	const endMs = Date.now();
	const startMs = endMs - maxDays * MS_PER_DAY;

	const [actualByDay, forecastByDay] = await Promise.all([
		fetchDailyMaxMap(host, actualStateId, startMs, endMs, maxDays),
		fetchDailyMaxMap(host, forecastStateId, startMs, endMs, maxDays),
	]);

	const pairs: PvBiasDayPair[] = [];
	let actualDays = 0;
	let forecastDays = 0;

	for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
		const { start } = dayBoundsMs(dayOffset);
		const dateKey = localDateKey(start);

		let actualKwh = actualByDay.get(dateKey) ?? null;
		let forecastKwh = forecastByDay.get(dateKey) ?? null;

		if (dayOffset === 0) {
			// Heute: Freeze-Wert hat Vorrang (Anti-Drift), sonst Live-Lesung.
			if (todayForecastOverride !== null && todayForecastOverride > 0) {
				forecastKwh = todayForecastOverride;
			}
			if (actualKwh === null) {
				actualKwh = await readLiveValue(host, actualStateId);
			}
			if (forecastKwh === null) {
				forecastKwh = await readLiveValue(host, forecastStateId);
			}
		}

		if (actualKwh !== null) actualDays++;
		if (forecastKwh !== null && forecastKwh > 0) forecastDays++;

		if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
			continue;
		}
		pairs.push({ dayOffset, actualKwh, forecastKwh });
	}

	if (pairs.length >= Math.min(maxDays, 7)) {
		return { pairs, actualDays, forecastDays, forecastSourceUsed: forecastStateId };
	}

	// Fallback: Tages-Fenster einzeln (z. B. wenn aggregate leer)
	const fallback = await Promise.all(
		Array.from({ length: maxDays }, (_, dayOffset) =>
			fetchDayPairFallback(host, dayOffset, actualStateId, forecastStateId, todayForecastOverride),
		),
	);
	const fbPairs = fallback.filter((p): p is PvBiasDayPair => p !== null);
	if (fbPairs.length > pairs.length) {
		return {
			pairs: fbPairs,
			actualDays: Math.max(actualDays, fbPairs.length),
			forecastDays: Math.max(forecastDays, fbPairs.length),
			forecastSourceUsed: forecastStateId,
		};
	}
	return { pairs, actualDays, forecastDays, forecastSourceUsed: forecastStateId };
}

async function fetchDayPairFallback(
	host: HistoryHost,
	dayOffset: number,
	actualStateId: string,
	forecastStateId: string,
	todayForecastOverride: number | null = null,
): Promise<PvBiasDayPair | null> {
	const { start, end } = dayBoundsMs(dayOffset);
	let actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
	let forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);

	if (dayOffset === 0) {
		if (todayForecastOverride !== null && todayForecastOverride > 0) {
			forecastKwh = todayForecastOverride;
		}
		if (actualKwh === null) {
			actualKwh = await readLiveValue(host, actualStateId);
		}
		if (forecastKwh === null) {
			forecastKwh = await readLiveValue(host, forecastStateId);
		}
	}

	if (actualKwh === null || forecastKwh === null || forecastKwh <= 0) {
		return null;
	}
	return { dayOffset, actualKwh, forecastKwh };
}

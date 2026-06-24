import { asNum } from "../../ems_light/state_util";
import {
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

/** Sammelt gültige Tagespaare für die letzten 30 Tage (inkl. heute). Fehlende Tage werden übersprungen. */
async function fetchDayPair(
	host: HistoryHost,
	dayOffset: number,
	actualStateId: string,
	forecastStateId: string,
): Promise<PvBiasDayPair | null> {
	const { start, end } = dayBoundsMs(dayOffset);
	let actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
	let forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);

	if (dayOffset === 0) {
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

export async function fetchPvBiasDayPairs(
	host: HistoryHost,
	actualStateId: string,
	forecastStateId: string,
	maxDays = 30,
): Promise<PvBiasDayPair[]> {
	const results = await Promise.all(
		Array.from({ length: maxDays }, (_, dayOffset) =>
			fetchDayPair(host, dayOffset, actualStateId, forecastStateId),
		),
	);
	return results.filter((p): p is PvBiasDayPair => p !== null);
}

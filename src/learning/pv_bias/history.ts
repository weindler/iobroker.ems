import { asNum } from "../../ems_light/state_util";
import type { PvBiasDayPair } from "./types";

export type HistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
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
	try {
		const res = await host.getHistoryAsync(stateId, {
			start: startMs,
			end: endMs,
			aggregate: "onchange",
			ignoreNull: true,
			count: 500,
			returnNewestEntries: true,
			removeBorderValues: true,
		});
		const rows = res.result;
		if (!Array.isArray(rows) || rows.length === 0) {
			return null;
		}
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i];
			const n = asNum(row?.val);
			if (n !== null) {
				return n;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/** Sammelt gültige Tagespaare für die letzten 30 Tage (inkl. heute). Fehlende Tage werden übersprungen. */
export async function fetchPvBiasDayPairs(
	host: HistoryHost,
	actualStateId: string,
	forecastStateId: string,
	maxDays = 30,
): Promise<PvBiasDayPair[]> {
	const pairs: PvBiasDayPair[] = [];
	for (let dayOffset = 0; dayOffset < maxDays; dayOffset++) {
		const { start, end } = dayBoundsMs(dayOffset);
		const actualKwh = await fetchDayLastValue(host, actualStateId, start, end);
		const forecastKwh = await fetchDayLastValue(host, forecastStateId, start, end);
		if (actualKwh === null || forecastKwh === null) {
			continue;
		}
		if (forecastKwh <= 0) {
			continue;
		}
		pairs.push({ dayOffset, actualKwh, forecastKwh });
	}
	return pairs;
}

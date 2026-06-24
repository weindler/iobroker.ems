import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import { PLAUSIBLE_TEMP_MAX_C, PLAUSIBLE_TEMP_MIN_C } from "./constants";
import type { TempPoint } from "./types";

export type ThermalHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
};

/** missing ≠ 0 — nur endliche, plausible °C-Werte. */
export function isValidTempC(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	return value >= PLAUSIBLE_TEMP_MIN_C && value <= PLAUSIBLE_TEMP_MAX_C;
}

export async function fetchTemperatureHistory(
	host: ThermalHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ points: TempPoint[]; lastValidTs: number | null }> {
	const points: TempPoint[] = [];
	let lastValidTs: number | null = null;

	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const tempC = asNum(row?.val);
		if (ts === null || !isValidTempC(tempC)) {
			continue;
		}
		points.push({ ts, tempC: Math.round(tempC * 100) / 100 });
		if (lastValidTs === null || ts > lastValidTs) {
			lastValidTs = ts;
		}
	}

	points.sort((a, b) => a.ts - b.ts);
	return { points, lastValidTs };
}

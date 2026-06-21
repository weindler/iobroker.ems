import { asNum } from "../../ems_light/state_util";
import {
	HISTORY_QUERY_TIMEOUT_MS,
	MS_PER_DAY,
	PLAUSIBLE_TEMP_MAX_C,
	PLAUSIBLE_TEMP_MIN_C,
} from "./constants";
import type { TempPoint } from "./types";

export type ThermalHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
};

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
	const end = Date.now();
	const start = end - lookbackDays * MS_PER_DAY;
	const points: TempPoint[] = [];
	let lastValidTs: number | null = null;

	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start,
			end,
			aggregate: "onchange",
			ignoreNull: true,
			count: 50_000,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		HISTORY_QUERY_TIMEOUT_MS,
	);

	if (!res?.result || !Array.isArray(res.result)) {
		return { points, lastValidTs };
	}

	for (const row of res.result) {
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

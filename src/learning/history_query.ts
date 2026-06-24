/**
 * History-Abfragen in Tagesfenstern (wie PV-Bias).
 * Große 90-Tage-Bulk-Queries liefern in der Praxis oft leer — Tages-Chunks zuverlässiger.
 */

export type HistoryQueryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
};

export const HISTORY_CHUNK_TIMEOUT_MS = 10_000;
export const HISTORY_ROWS_PER_DAY = 5_000;
const MS_PER_DAY = 86_400_000;

/** Lokale Mitternachtsgrenzen (dayOffset 0 = heute). */
export function dayBoundsMs(dayOffset: number): { start: number; end: number } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const start = d.getTime();
	return { start, end: start + MS_PER_DAY };
}

export async function withHistoryTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
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

export async function fetchHistoryRowsInRange(
	host: HistoryQueryHost,
	stateId: string,
	startMs: number,
	endMs: number,
	count = HISTORY_ROWS_PER_DAY,
	timeoutMs = HISTORY_CHUNK_TIMEOUT_MS,
): Promise<ioBroker.GetHistoryResult> {
	if (!stateId) {
		return [];
	}
	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start: startMs,
			end: endMs,
			aggregate: "onchange",
			ignoreNull: true,
			count,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		timeoutMs,
	);
	if (!res?.result || !Array.isArray(res.result)) {
		return [];
	}
	return res.result;
}

/** Lookback in Tages-Chunks parallel (bewährt bei PV-Bias). */
export async function fetchHistoryRowsLookback(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
	countPerDay = HISTORY_ROWS_PER_DAY,
	timeoutMs = HISTORY_CHUNK_TIMEOUT_MS,
): Promise<ioBroker.GetHistoryResult> {
	if (!stateId || lookbackDays <= 0) {
		return [];
	}
	const chunks = await Promise.all(
		Array.from({ length: lookbackDays }, (_, dayOffset) => {
			const { start, end } = dayBoundsMs(dayOffset);
			return fetchHistoryRowsInRange(host, stateId, start, end, countPerDay, timeoutMs);
		}),
	);
	const merged = chunks.flat();
	merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
	return merged;
}

/**
 * History-Abfragen in Tagesfenstern (wie PV-Bias).
 * Große 90-Tage-Bulk-Queries liefern in der Praxis oft leer — Tages-Chunks zuverlässiger.
 */

export type HistoryQueryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	log?: { warn?: (msg: string) => void };
};

/** Wie PV-Bias fetchDayLastValue — ausreichend für onchange-Tagesfenster. */
export const HISTORY_ROWS_PER_DAY = 500;
export const HISTORY_CHUNK_TIMEOUT_MS = 10_000;
/** Zu viele parallele getHistoryAsync-Calls überlasten history.0 (90× parallel → oft leer). */
export const HISTORY_DAY_CONCURRENCY = 8;
const MS_PER_DAY = 86_400_000;

/** Lokale Mitternachtsgrenzen (dayOffset 0 = heute). */
export function dayBoundsMs(dayOffset: number): { start: number; end: number } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const start = d.getTime();
	return { start, end: start + MS_PER_DAY };
}

function uniqueIds(ids: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		const trimmed = id.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * Alias ohne eigene Historie → Quell-State (z. B. sonnen.0.status.userSoc).
 * Alias mit Historie → zuerst Alias, dann Quell-State als Fallback.
 */
export async function historyStateCandidates(
	host: HistoryQueryHost,
	stateId: string,
): Promise<string[]> {
	if (!stateId) {
		return [];
	}
	if (!host.getObjectAsync || !stateId.startsWith("alias.")) {
		return [stateId];
	}

	try {
		const obj = await host.getObjectAsync(stateId);
		const common = obj?.common as
			| { history?: { enabled?: boolean }; alias?: { id?: string } }
			| undefined;
		const nativeId = common?.alias?.id?.trim();
		if (!nativeId || nativeId === stateId) {
			return [stateId];
		}
		if (common?.history?.enabled) {
			return uniqueIds([stateId, nativeId]);
		}
		return uniqueIds([nativeId, stateId]);
	} catch {
		return [stateId];
	}
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

async function mapInBatches<T, R>(
	items: T[],
	batchSize: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < items.length; i += batchSize) {
		const slice = items.slice(i, i + batchSize);
		const part = await Promise.all(slice.map((item, j) => fn(item, i + j)));
		out.push(...part);
	}
	return out;
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

async function fetchHistoryRowsLookbackForId(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
	countPerDay: number,
	timeoutMs: number,
): Promise<ioBroker.GetHistoryResult> {
	const dayOffsets = Array.from({ length: lookbackDays }, (_, dayOffset) => dayOffset);
	const chunks = await mapInBatches(dayOffsets, HISTORY_DAY_CONCURRENCY, async (dayOffset) => {
		const { start, end } = dayBoundsMs(dayOffset);
		return fetchHistoryRowsInRange(host, stateId, start, end, countPerDay, timeoutMs);
	});
	const merged = chunks.flat();
	merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
	return merged;
}

/** Lookback in Tages-Chunks mit begrenzter Parallelität; Alias→Quell-Fallback. */
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

	const candidates = await historyStateCandidates(host, stateId);
	for (let i = 0; i < candidates.length; i++) {
		const candidateId = candidates[i];
		const rows = await fetchHistoryRowsLookbackForId(
			host,
			candidateId,
			lookbackDays,
			countPerDay,
			timeoutMs,
		);
		if (rows.length > 0) {
			if (i > 0 && host.log?.warn) {
				host.log.warn(
					`History query: Daten über Fallback-State ${candidateId} (${rows.length} Zeilen, konfiguriert: ${stateId})`,
				);
			}
			return rows;
		}
	}

	if (host.log?.warn) {
		const tried = candidates.join(" → ");
		host.log.warn(
			`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}) — history.0 am State prüfen`,
		);
	}
	return [];
}

/**
 * History-Abfragen für Learning-Module.
 * Bulk-Fenster zuerst (1× history.0), Tages-Chunks als Fallback.
 */

export type HistoryQueryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	sendToAsync?: (
		instanceName: string,
		command: string,
		message: unknown,
	) => Promise<unknown>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	log?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
};

export const HISTORY_ROWS_PER_DAY = 500;
/** history.0 antwortet auf belasteten Hosts oft erst nach >10 s — kurzer Timeout → leere Arrays. */
export const HISTORY_CHUNK_TIMEOUT_MS = 45_000;
export const HISTORY_BULK_TIMEOUT_MS = 60_000;
export const HISTORY_DAY_CONCURRENCY = 4;

export const HISTORY_AGGREGATES = ["onchange", "none"] as const;
export type HistoryAggregate = (typeof HISTORY_AGGREGATES)[number];

/** history.0: returnNewestEntries + count kann Tagesfenster leeren (ioBroker/history#238). */
export const HISTORY_QUERY_OPTIONS: ioBroker.GetHistoryOptions = {
	ignoreNull: true,
	returnNewestEntries: false,
	removeBorderValues: false,
};

const MS_PER_DAY = 86_400_000;

type HistoryFetchStats = {
	timedOut: number;
	empty: number;
	errors: number;
};

type HistoryFetchResult = {
	rows: ioBroker.GetHistoryResult;
	stats: HistoryFetchStats;
};

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

function rowsFromHistoryMessage(res: unknown): ioBroker.GetHistoryResult {
	if (!res || typeof res !== "object") {
		return [];
	}
	const payload = res as { result?: unknown; error?: unknown };
	if (payload.error) {
		return [];
	}
	return Array.isArray(payload.result) ? payload.result : [];
}

async function invokeGetHistory(
	host: HistoryQueryHost,
	stateId: string,
	options: ioBroker.GetHistoryOptions,
	timeoutMs: number,
): Promise<{ rows: ioBroker.GetHistoryResult; timedOut: boolean; error: boolean }> {
	const res = await withHistoryTimeout(
		(async () => {
			if (host.sendToAsync) {
				try {
					return await host.sendToAsync("history.0", "getHistory", { id: stateId, options });
				} catch {
					// getHistoryAsync versucht defaultHistory-Instanz
				}
			}
			return host.getHistoryAsync(stateId, options);
		})(),
		timeoutMs,
	);

	if (res === null) {
		return { rows: [], timedOut: true, error: false };
	}

	const rows = rowsFromHistoryMessage(res);
	if (!Array.isArray((res as { result?: unknown }).result) && rows.length === 0) {
		const err = (res as { error?: unknown }).error;
		if (err) {
			return { rows: [], timedOut: false, error: true };
		}
	}

	return { rows, timedOut: false, error: false };
}

function mergeStats(a: HistoryFetchStats, b: HistoryFetchStats): HistoryFetchStats {
	return {
		timedOut: a.timedOut + b.timedOut,
		empty: a.empty + b.empty,
		errors: a.errors + b.errors,
	};
}

function emptyStats(): HistoryFetchStats {
	return { timedOut: 0, empty: 0, errors: 0 };
}

export async function fetchHistoryRowsInRange(
	host: HistoryQueryHost,
	stateId: string,
	startMs: number,
	endMs: number,
	count = HISTORY_ROWS_PER_DAY,
	timeoutMs = HISTORY_CHUNK_TIMEOUT_MS,
	aggregate: HistoryAggregate = "onchange",
): Promise<ioBroker.GetHistoryResult> {
	const result = await fetchHistoryRowsInRangeDetailed(
		host,
		stateId,
		startMs,
		endMs,
		count,
		timeoutMs,
		aggregate,
	);
	return result.rows;
}

async function fetchHistoryRowsInRangeDetailed(
	host: HistoryQueryHost,
	stateId: string,
	startMs: number,
	endMs: number,
	count: number,
	timeoutMs: number,
	aggregate: HistoryAggregate,
): Promise<HistoryFetchResult> {
	if (!stateId) {
		return { rows: [], stats: emptyStats() };
	}

	const { rows, timedOut, error } = await invokeGetHistory(
		host,
		stateId,
		{
			...HISTORY_QUERY_OPTIONS,
			aggregate,
			start: startMs,
			end: endMs,
			count,
		},
		timeoutMs,
	);

	const stats = emptyStats();
	if (timedOut) stats.timedOut = 1;
	else if (error) stats.errors = 1;
	else if (rows.length === 0) stats.empty = 1;

	return { rows, stats };
}

async function fetchHistoryWithAggregates(
	host: HistoryQueryHost,
	stateId: string,
	startMs: number,
	endMs: number,
	count: number,
	timeoutMs: number,
): Promise<HistoryFetchResult> {
	let stats = emptyStats();
	for (const aggregate of HISTORY_AGGREGATES) {
		const attempt = await fetchHistoryRowsInRangeDetailed(
			host,
			stateId,
			startMs,
			endMs,
			count,
			timeoutMs,
			aggregate,
		);
		stats = mergeStats(stats, attempt.stats);
		if (attempt.rows.length > 0) {
			return { rows: attempt.rows, stats };
		}
	}
	return { rows: [], stats };
}

/** Ein Fenster für den gesamten Lookback — weniger Roundtrips, höheres Timeout. */
async function fetchHistoryBulkForId(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
): Promise<HistoryFetchResult> {
	const endMs = Date.now();
	const startMs = endMs - lookbackDays * MS_PER_DAY;
	const count = Math.min(Math.max(lookbackDays * 120, 500), 20_000);
	return fetchHistoryWithAggregates(host, stateId, startMs, endMs, count, HISTORY_BULK_TIMEOUT_MS);
}

async function fetchHistoryPerDayForId(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
	countPerDay: number,
	timeoutMs: number,
): Promise<HistoryFetchResult> {
	const dayOffsets = Array.from({ length: lookbackDays }, (_, dayOffset) => dayOffset);
	let stats = emptyStats();
	const chunks = await mapInBatches(dayOffsets, HISTORY_DAY_CONCURRENCY, async (dayOffset) => {
		const { start, end } = dayBoundsMs(dayOffset);
		const attempt = await fetchHistoryWithAggregates(
			host,
			stateId,
			start,
			end,
			countPerDay,
			timeoutMs,
		);
		stats = mergeStats(stats, attempt.stats);
		return attempt.rows;
	});
	const merged = chunks.flat();
	merged.sort((a, b) => (typeof a?.ts === "number" ? a.ts : 0) - (typeof b?.ts === "number" ? b.ts : 0));
	return { rows: merged, stats };
}

async function fetchHistoryRowsLookbackForId(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
	countPerDay: number,
	timeoutMs: number,
): Promise<HistoryFetchResult> {
	const bulk = await fetchHistoryBulkForId(host, stateId, lookbackDays);
	if (bulk.rows.length > 0) {
		return bulk;
	}

	const perDay = await fetchHistoryPerDayForId(host, stateId, lookbackDays, countPerDay, timeoutMs);
	return {
		rows: perDay.rows,
		stats: mergeStats(bulk.stats, perDay.stats),
	};
}

function formatHistoryStats(stats: HistoryFetchStats): string {
	const parts: string[] = [];
	if (stats.timedOut > 0) parts.push(`${stats.timedOut}× timeout`);
	if (stats.empty > 0) parts.push(`${stats.empty}× leer`);
	if (stats.errors > 0) parts.push(`${stats.errors}× Fehler`);
	return parts.length > 0 ? parts.join(", ") : "keine Antwort";
}

/** Lookback: Bulk zuerst, dann Tages-Chunks; Alias→Quell-Fallback. */
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
	let combinedStats = emptyStats();

	for (let i = 0; i < candidates.length; i++) {
		const candidateId = candidates[i];
		const attempt = await fetchHistoryRowsLookbackForId(
			host,
			candidateId,
			lookbackDays,
			countPerDay,
			timeoutMs,
		);
		combinedStats = mergeStats(combinedStats, attempt.stats);

		if (attempt.rows.length > 0) {
			if (i > 0 && host.log?.warn) {
				host.log.warn(
					`History query: Daten über Fallback-State ${candidateId} (${attempt.rows.length} Zeilen, konfiguriert: ${stateId})`,
				);
			}
			if (host.log?.debug) {
				host.log.debug(`History query: ${attempt.rows.length} rows for ${candidateId} (${lookbackDays}d)`);
			}
			return attempt.rows;
		}
	}

	if (host.log?.warn) {
		const tried = candidates.join(" → ");
		host.log.warn(
			`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}, ${formatHistoryStats(combinedStats)}) — history.0/langsame Antwort?`,
		);
	}
	return [];
}

/**
 * History-Abfragen für Learning-Module.
 * sendTo('history.0','getHistory') via Callback-Bridge (wie javascript.0).
 * getHistoryAsync nur wenn kein sendToAsync am Host.
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
	log?: { info?: (msg: string) => void; warn?: (msg: string) => void; debug?: (msg: string) => void };
};

export const HISTORY_ROWS_PER_DAY = 500;
export const HISTORY_CHUNK_TIMEOUT_MS = 45_000;
export const HISTORY_BULK_TIMEOUT_MS = 45_000;
export const HISTORY_DAY_CONCURRENCY = 4;
/** Nach leerem Bulk: max. so viele Tage einzeln — 90d×2 Aggregate würde den Tick blockieren. */
export const PER_DAY_FALLBACK_MAX_DAYS = 7;

export const HISTORY_AGGREGATES = ["none", "onchange"] as const;
export type HistoryAggregate = (typeof HISTORY_AGGREGATES)[number];

export const HISTORY_QUERY_OPTIONS: ioBroker.GetHistoryOptions = {
	ignoreNull: true,
	returnNewestEntries: false,
	removeBorderValues: false,
};

const MS_PER_DAY = 86_400_000;

/** history.0 / manche Adapter liefern Unix-Sekunden — dann landen 840 Zeilen in 1–2 h-Buckets. */
export function normalizeHistoryTs(ts: number): number {
	if (!Number.isFinite(ts) || ts <= 0) {
		return ts;
	}
	// 2026 ms ≈ 1.78e12; Sekunden ≈ 1.78e9 — Grenze weit unter beiden ms-Werten
	if (ts < 100_000_000_000) {
		return ts * 1000;
	}
	return ts;
}

export function normalizeHistoryRows(rows: ioBroker.GetHistoryResult): ioBroker.GetHistoryResult {
	return rows.map((row) => {
		if (!row || typeof row.ts !== "number") {
			return row;
		}
		const ts = normalizeHistoryTs(row.ts);
		return ts === row.ts ? row : { ...row, ts };
	});
}

type HistoryFetchStats = {
	timedOut: number;
	empty: number;
	errors: number;
};

type HistoryFetchResult = {
	rows: ioBroker.GetHistoryResult;
	stats: HistoryFetchStats;
};

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

function unwrapHistoryPayload(res: unknown): { result?: unknown; error?: unknown } {
	if (!res || typeof res !== "object") {
		return {};
	}
	const obj = res as Record<string, unknown>;
	if ("result" in obj || "error" in obj) {
		return obj as { result?: unknown; error?: unknown };
	}
	// adapter.sendToAsync liefert ioBroker.Message — Payload liegt in .message
	if (obj.message && typeof obj.message === "object") {
		const msg = obj.message as Record<string, unknown>;
		if ("result" in msg || "error" in msg) {
			return msg as { result?: unknown; error?: unknown };
		}
	}
	return {};
}

function rowsFromHistoryMessage(res: unknown): ioBroker.GetHistoryResult {
	const payload = unwrapHistoryPayload(res);
	if (payload.error) {
		return [];
	}
	return Array.isArray(payload.result) ? payload.result : [];
}

function parseHistoryResponse(res: unknown): {
	rows: ioBroker.GetHistoryResult;
	timedOut: boolean;
	error: boolean;
} {
	if (res === null) {
		return { rows: [], timedOut: true, error: false };
	}
	const rows = rowsFromHistoryMessage(res);
	const err = unwrapHistoryPayload(res).error;
	if (err && rows.length === 0) {
		return { rows: [], timedOut: false, error: true };
	}
	return { rows, timedOut: false, error: false };
}

/** sendTo history.0 (Callback-Bridge); kein getHistoryAsync-Fallback bei leerem sendTo. */
async function invokeGetHistory(
	host: HistoryQueryHost,
	stateId: string,
	options: ioBroker.GetHistoryOptions,
	timeoutMs: number,
): Promise<{ rows: ioBroker.GetHistoryResult; timedOut: boolean; error: boolean }> {
	const message = { id: stateId, options };

	if (host.sendToAsync) {
		const viaSendTo = await withHistoryTimeout(
			host.sendToAsync("history.0", "getHistory", message),
			timeoutMs,
		);
		return parseHistoryResponse(viaSendTo);
	}

	const viaAsync = await withHistoryTimeout(host.getHistoryAsync(stateId, options), timeoutMs);
	return parseHistoryResponse(viaAsync);
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

	const normalized = normalizeHistoryRows(rows);

	const stats = emptyStats();
	if (timedOut) stats.timedOut = 1;
	else if (error) stats.errors = 1;
	else if (normalized.length === 0) stats.empty = 1;

	return { rows: normalized, stats };
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

function bulkWindowDays(lookbackDays: number): number[] {
	const windows: number[] = [];
	for (const days of [7, 30, lookbackDays]) {
		if (days > 0 && days <= lookbackDays && !windows.includes(days)) {
			windows.push(days);
		}
	}
	return windows.sort((a, b) => a - b);
}

async function fetchHistoryBulkForId(
	host: HistoryQueryHost,
	stateId: string,
	lookbackDays: number,
): Promise<HistoryFetchResult> {
	let combinedStats = emptyStats();
	for (const days of bulkWindowDays(lookbackDays)) {
		if (host.log?.info) {
			host.log.info(`History query: bulk ${days}d für ${stateId}…`);
		}
		const endMs = Date.now();
		const startMs = endMs - days * MS_PER_DAY;
		const count = Math.min(Math.max(days * 120, 500), 20_000);
		const attempt = await fetchHistoryWithAggregates(
			host,
			stateId,
			startMs,
			endMs,
			count,
			HISTORY_BULK_TIMEOUT_MS,
		);
		combinedStats = mergeStats(combinedStats, attempt.stats);
		if (attempt.rows.length > 0) {
			return attempt;
		}
		if (host.log?.warn) {
			host.log.warn(
				`History query: bulk ${days}d ohne Treffer (${formatHistoryStats(attempt.stats)}) für ${stateId}`,
			);
		}
	}
	return { rows: [], stats: combinedStats };
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

	const fallbackDays = Math.min(lookbackDays, PER_DAY_FALLBACK_MAX_DAYS);
	if (host.log?.info) {
		host.log.info(
			`History query: Tages-Fallback ${fallbackDays}d für ${stateId} (${formatHistoryStats(bulk.stats)})`,
		);
	}

	const perDay = await fetchHistoryPerDayForId(host, stateId, fallbackDays, countPerDay, timeoutMs);
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
			} else if (host.log?.info) {
				host.log.info(`History query: ${attempt.rows.length} Zeilen für ${candidateId} (${lookbackDays}d)`);
			}
			return attempt.rows;
		}
	}

	if (host.log?.warn) {
		const tried = candidates.join(" → ");
		host.log.warn(
			`History query: 0 rows for ${stateId} (${lookbackDays}d, tried: ${tried}, ${formatHistoryStats(combinedStats)})`,
		);
	}
	return [];
}

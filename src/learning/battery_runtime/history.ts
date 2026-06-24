import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsInRange,
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import {
	MS_PER_HOUR,
	PLAUSIBLE_POWER_W_MAX,
	POWER_DEADBAND_W,
	SOC_MAX,
	SOC_MIN,
} from "./constants";
import { localDateKey } from "./time";
import type { AstroTimePoint, DailyAstroTimes, PowerPoint, SocPoint } from "./types";

export function parseAstroTimeValue(raw: unknown): { hour: number; minute: number } | null {
	if (raw === null || raw === undefined) return null;
	const text = String(raw).trim();
	const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (!m) return null;
	const hour = parseInt(m[1], 10);
	const minute = parseInt(m[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
}

export async function fetchAstroTimeHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<AstroTimePoint[]> {
	const points: AstroTimePoint[] = [];
	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const parsed = parseAstroTimeValue(row?.val);
		if (ts === null || !parsed) continue;
		points.push({
			ts,
			dateKey: localDateKey(new Date(ts)),
			hour: parsed.hour,
			minute: parsed.minute,
		});
	}

	points.sort((a, b) => a.ts - b.ts);
	return points;
}

/** Pro Kalendertag die zuletzt geschriebene Astro-Zeit (tägliches JS-Update). */
export function buildDailyAstroTimes(points: AstroTimePoint[]): DailyAstroTimes {
	const startByDate = new Map<string, { hour: number; minute: number }>();
	const endByDate = new Map<string, { hour: number; minute: number }>();
	for (const p of points) {
		startByDate.set(p.dateKey, { hour: p.hour, minute: p.minute });
	}
	return { startByDate, endByDate };
}

export function mergeDailyAstroTimes(
	startPoints: AstroTimePoint[],
	endPoints: AstroTimePoint[],
): DailyAstroTimes {
	const start = buildDailyAstroTimes(startPoints);
	const end = buildDailyAstroTimes(endPoints);
	return { startByDate: start.startByDate, endByDate: end.endByDate };
}

export type BatteryHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

function hourBucket(ts: number): number {
	return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

export function isValidSoc(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) return false;
	return value >= SOC_MIN && value <= SOC_MAX;
}

export function isValidCapacityKwh(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) return false;
	return value > 0 && value <= 500;
}

/**
 * Nach Normalisierung: positiv = laden, negativ = entladen.
 * @param invert Quell-Vorzeichen umdrehen (z. B. Sonnen pacTotal: + entladen, − laden).
 */
export function normalizeBatteryPowerW(raw: number | null, invert = false): number | null {
	if (raw === null || !Number.isFinite(raw)) return null;
	const signed = invert ? -raw : raw;
	if (Math.abs(signed) > PLAUSIBLE_POWER_W_MAX) return null;
	if (Math.abs(signed) < POWER_DEADBAND_W) return null;
	return Math.round(signed);
}

async function fetchHistoryPoints(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
	parseVal: (raw: unknown) => number | null,
): Promise<{ points: { ts: number; value: number }[]; lastValidTs: number | null }> {
	const byHour = new Map<number, { ts: number; value: number }>();
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
		const value = parseVal(row?.val);
		if (ts === null || value === null) continue;
		const bucket = hourBucket(ts);
		const existing = byHour.get(bucket);
		if (!existing || ts > existing.ts) {
			byHour.set(bucket, { ts, value });
		}
		if (lastValidTs === null || ts > lastValidTs) {
			lastValidTs = ts;
		}
	}

	const points = [...byHour.values()].sort((a, b) => a.ts - b.ts);
	return { points, lastValidTs };
}

export async function fetchSocHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ points: SocPoint[]; lastValidTs: number | null }> {
	const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
		const n = asNum(raw);
		return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
	});
	return {
		points: points.map((p) => ({ ts: p.ts, socPct: p.value })),
		lastValidTs,
	};
}

export async function fetchPowerHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
	powerInvert = false,
): Promise<{ points: PowerPoint[]; lastValidTs: number | null }> {
	const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
		const n = asNum(raw);
		return normalizeBatteryPowerW(n, powerInvert);
	});
	return {
		points: points.map((p) => ({ ts: p.ts, powerW: p.value })),
		lastValidTs,
	};
}

export async function readLiveCapacityKwh(
	host: BatteryHistoryHost,
	stateId: string,
): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		return isValidCapacityKwh(n) ? Math.round(n * 1000) / 1000 : null;
	} catch {
		return null;
	}
}

export async function readLiveSoc(
	host: BatteryHistoryHost,
	stateId: string,
): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
	} catch {
		return null;
	}
}

export function distinctSocSampleDays(points: SocPoint[]): number {
	return new Set(points.map((p) => new Date(p.ts).toISOString().slice(0, 10))).size;
}

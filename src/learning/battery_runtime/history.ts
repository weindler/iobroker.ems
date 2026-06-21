import { asNum } from "../../ems_light/state_util";
import {
	HISTORY_QUERY_TIMEOUT_MS,
	MS_PER_DAY,
	MS_PER_HOUR,
	PLAUSIBLE_POWER_W_MAX,
	POWER_DEADBAND_W,
	SOC_MAX,
	SOC_MIN,
} from "./constants";
import type { PowerPoint, SocPoint } from "./types";

export type BatteryHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
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
	const end = Date.now();
	const start = end - lookbackDays * MS_PER_DAY;
	const byHour = new Map<number, { ts: number; value: number }>();
	let lastValidTs: number | null = null;

	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start,
			end,
			aggregate: "onchange",
			ignoreNull: true,
			count: 40_000,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		HISTORY_QUERY_TIMEOUT_MS,
	);

	if (!res?.result || !Array.isArray(res.result)) {
		return { points: [], lastValidTs };
	}

	for (const row of res.result) {
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

import { asNum } from "../../ems_light/state_util";
import {
	HISTORY_QUERY_TIMEOUT_MS,
	MS_PER_DAY,
	MS_PER_HOUR,
	PLAUSIBLE_W_MAX,
	PLAUSIBLE_W_MIN,
} from "./constants";
import { calendarContext } from "./time";
import type { HouseLoadSample } from "./types";

export type HouseLoadHistoryHost = {
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

function hourStartMs(ts: number): number {
	return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte. */
export function isValidHouseLoadW(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	return value >= PLAUSIBLE_W_MIN && value <= PLAUSIBLE_W_MAX;
}

/** Negative und Ausreißer oberhalb PLAUSIBLE_W_MAX verwerfen. */
export function filterOutliers(values: number[]): number[] {
	if (values.length < 5) {
		return values;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const q1 = sorted[Math.floor(sorted.length * 0.25)];
	const q3 = sorted[Math.floor(sorted.length * 0.75)];
	const iqr = q3 - q1;
	const low = q1 - 1.5 * iqr;
	const high = q3 + 1.5 * iqr;
	return values.filter((v) => v >= low && v <= high);
}

export async function fetchHouseLoadSamples(
	host: HouseLoadHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ samples: HouseLoadSample[]; lastValidTs: number | null }> {
	const end = Date.now();
	const start = end - lookbackDays * MS_PER_DAY;
	const samples: HouseLoadSample[] = [];
	let lastValidTs: number | null = null;

	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start,
			end,
			aggregate: "onchange",
			ignoreNull: true,
			count: 30_000,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		HISTORY_QUERY_TIMEOUT_MS,
	);

	if (!res?.result || !Array.isArray(res.result)) {
		return { samples, lastValidTs };
	}

	const byHour = new Map<number, number>();
	for (const row of res.result) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const raw = asNum(row?.val);
		if (ts === null || !isValidHouseLoadW(raw)) {
			continue;
		}
		if (raw < 0) {
			continue;
		}
		const bucket = hourStartMs(ts);
		const existing = byHour.get(bucket);
		if (existing === undefined || ts > (lastValidTs ?? 0)) {
			byHour.set(bucket, raw);
		}
		if (lastValidTs === null || ts > lastValidTs) {
			lastValidTs = ts;
		}
	}

	for (const [bucket, powerW] of byHour) {
		const d = new Date(bucket);
		const ctx = calendarContext(d);
		samples.push({
			ts: bucket,
			hourStartMs: bucket,
			dateKey: ctx.dateKey,
			hourOfDay: ctx.hourOfDay,
			segment: ctx.segment,
			season: ctx.season,
			weekday: ctx.weekday,
			dayType: ctx.dayType,
			powerW: Math.round(powerW),
		});
	}

	samples.sort((a, b) => a.hourStartMs - b.hourStartMs);
	return { samples, lastValidTs };
}

export function distinctSampleDays(samples: HouseLoadSample[]): number {
	return new Set(samples.map((s) => s.dateKey)).size;
}

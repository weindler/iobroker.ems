import { asNum } from "../../ems_light/state_util";
import { HISTORY_QUERY_TIMEOUT_MS, MS_PER_DAY } from "./constants";
import type { WeatherMetricKey } from "./constants";
import { isValidMetricValue, metricBias, confidenceFromValidHours, healthFromValidHours } from "./math";
import type { WeatherDayResult, WeatherMetricMapping } from "./types";

export type WeatherHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

function isForeignStateId(stateId: string): boolean {
	return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}

export async function readStateNum(host: WeatherHistoryHost, stateId: string): Promise<number | null> {
	if (!stateId) {
		return null;
	}
	const tryRead = async (
		fn?: (id: string) => Promise<ioBroker.State | null | undefined>,
	): Promise<number | null> => {
		if (!fn) return null;
		try {
			const st = await fn.call(host, stateId);
			return asNum(st?.val);
		} catch {
			return null;
		}
	};
	if (isForeignStateId(stateId)) {
		const foreign = await tryRead(host.getForeignStateAsync);
		if (foreign !== null) return foreign;
		return tryRead(host.getStateAsync);
	}
	const own = await tryRead(host.getStateAsync);
	if (own !== null) return own;
	return tryRead(host.getForeignStateAsync);
}

/** Lokale Mitternachtsgrenzen (dayOffset 0 = heute, 1 = gestern). */
export function dayBoundsMs(dayOffset: number): { start: number; end: number } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const start = d.getTime();
	return { start, end: start + MS_PER_DAY };
}

export function dateKeyFromOffset(dayOffset: number): string {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

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

function hourBucketMs(ts: number): number {
	return Math.floor(ts / 3_600_000) * 3_600_000;
}

/** Stündliche Werte im Kalendertag (Bucket = Stundenanfang). */
export async function fetchHourlyMap(
	host: WeatherHistoryHost,
	stateId: string,
	startMs: number,
	endMs: number,
): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	if (!stateId) return map;

	const res = await withHistoryTimeout(
		host.getHistoryAsync(stateId, {
			start: startMs,
			end: endMs,
			aggregate: "onchange",
			ignoreNull: true,
			count: 500,
			returnNewestEntries: true,
			removeBorderValues: true,
		}),
		HISTORY_QUERY_TIMEOUT_MS,
	);
	if (!res?.result || !Array.isArray(res.result)) {
		return map;
	}
	for (const row of res.result) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const n = asNum(row?.val);
		if (ts === null || n === null) continue;
		map.set(hourBucketMs(ts), n);
	}
	return map;
}

export async function evaluateWeatherDay(
	host: WeatherHistoryHost,
	metrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>>,
	dayOffset: number,
): Promise<WeatherDayResult> {
	const { start, end } = dayBoundsMs(dayOffset);
	const dateKey = dateKeyFromOffset(dayOffset);
	const keys = Object.keys(metrics) as WeatherMetricKey[];

	const hourlyByMetric: Partial<
		Record<WeatherMetricKey, { forecast: Map<number, number>; actual: Map<number, number> }>
	> = {};
	const missingForecast: WeatherMetricKey[] = [];
	const missingActual: WeatherMetricKey[] = [];

	for (const key of keys) {
		const mapping = metrics[key];
		if (!mapping) continue;
		const [forecastMap, actualMap] = await Promise.all([
			fetchHourlyMap(host, mapping.forecastStateId, start, end),
			fetchHourlyMap(host, mapping.actualStateId, start, end),
		]);
		if (forecastMap.size === 0) missingForecast.push(key);
		if (actualMap.size === 0) missingActual.push(key);
		hourlyByMetric[key] = { forecast: forecastMap, actual: actualMap };
	}

	const hourSets = keys
		.map((key) => {
			const pair = hourlyByMetric[key];
			if (!pair) return new Set<number>();
			const hours = new Set<number>();
			for (const h of pair.forecast.keys()) {
				if (pair.actual.has(h)) hours.add(h);
			}
			return hours;
		})
		.filter((s) => s.size > 0);

	let comparableHours: number[] = [];
	if (hourSets.length > 0) {
		const intersection = new Set(hourSets[0]);
		for (let i = 1; i < hourSets.length; i++) {
			for (const h of [...intersection]) {
				if (!hourSets[i].has(h)) intersection.delete(h);
			}
		}
		comparableHours = [...intersection].sort((a, b) => a - b);
	}

	const metricResults: WeatherDayResult["metrics"] = {};
	for (const key of keys) {
		const pair = hourlyByMetric[key];
		if (!pair) continue;
		const diffs: number[] = [];
		for (const h of comparableHours) {
			const f = pair.forecast.get(h) ?? null;
			const a = pair.actual.get(h) ?? null;
			if (!isValidMetricValue(key, f) || !isValidMetricValue(key, a)) continue;
			diffs.push(metricBias(a, f));
		}
		metricResults[key] = {
			bias: diffs.length > 0 ? diffs.reduce((s, v) => s + v, 0) / diffs.length : null,
			validHours: diffs.length,
		};
	}

	const validHours = comparableHours.length;

	return {
		dateKey,
		dayOffset,
		validHours,
		metrics: metricResults,
		missingForecast,
		missingActual,
		confidence: confidenceFromValidHours(validHours),
		health: healthFromValidHours(validHours),
	};
}

export async function fetchWeatherDayResults(
	host: WeatherHistoryHost,
	metrics: Partial<Record<WeatherMetricKey, WeatherMetricMapping>>,
	maxDays = 30,
): Promise<WeatherDayResult[]> {
	const results = await Promise.all(
		Array.from({ length: maxDays }, (_, dayOffset) =>
			evaluateWeatherDay(host, metrics, dayOffset),
		),
	);
	return results;
}

/**
 * Lokale Boiler-Temperaturhistorie — unabhängig von vollständigen Heizstab-Zyklen.
 * Getrennt von Puffer `thermal_runtime`.
 */

import type { TempPoint } from "../thermal_runtime/types";
import { isValidTempC } from "../thermal_runtime/history";

export const BOILER_SAMPLE_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const BOILER_SAMPLE_MIN_DELTA_C = 0.3;
/** ~90 Tage bei stündlichem Takt — reicht für Newton, ohne Persist-Sturm. */
export const BOILER_MAX_TEMP_SAMPLES = 2_200;
export const BOILER_HISTORY_FETCH_TIMEOUT_MS = 20_000;
/** Bulk-Pfad (≤7d): darf die gemeinsame History-Queue nicht mit 90-Tage-Chunks blockieren. */
export const BOILER_HISTORY_FETCH_LOOKBACK_DAYS = 7;
export const BOILER_HISTORY_JSON_SAMPLES = 80;

const MS_PER_DAY = 86_400_000;

export function appendBoilerTempSample(
	prev: TempPoint[],
	sample: TempPoint,
	nowMs: number,
	lookbackDays: number,
): TempPoint[] {
	if (!isValidTempC(sample.tempC) || !Number.isFinite(sample.ts) || sample.ts <= 0) {
		return trimBoilerTempSamples(prev, nowMs, lookbackDays);
	}
	const last = prev.length > 0 ? prev[prev.length - 1] : null;
	if (last) {
		const dt = sample.ts - last.ts;
		const dT = Math.abs(sample.tempC - last.tempC);
		if (dt >= 0 && dt < BOILER_SAMPLE_MIN_INTERVAL_MS && dT < BOILER_SAMPLE_MIN_DELTA_C) {
			return trimBoilerTempSamples(prev, nowMs, lookbackDays);
		}
	}
	return trimBoilerTempSamples([...prev, { ts: sample.ts, tempC: Math.round(sample.tempC * 100) / 100 }], nowMs, lookbackDays);
}

export function trimBoilerTempSamples(points: TempPoint[], nowMs: number, lookbackDays: number): TempPoint[] {
	const lookbackMs = Math.max(1, lookbackDays) * MS_PER_DAY;
	const cutoff = nowMs - lookbackMs;
	const kept = points.filter((p) => p.ts >= cutoff && isValidTempC(p.tempC));
	if (kept.length <= BOILER_MAX_TEMP_SAMPLES) return kept;
	return kept.slice(kept.length - BOILER_MAX_TEMP_SAMPLES);
}

export function mergeBoilerTempPoints(local: TempPoint[], fromHistory: TempPoint[]): TempPoint[] {
	const byTs = new Map<number, number>();
	for (const p of [...fromHistory, ...local]) {
		if (!Number.isFinite(p.ts) || !isValidTempC(p.tempC)) continue;
		byTs.set(p.ts, Math.round(p.tempC * 100) / 100);
	}
	return [...byTs.entries()]
		.map(([ts, tempC]) => ({ ts, tempC }))
		.sort((a, b) => a.ts - b.ts);
}

export function historyJsonFromBoilerPoints(points: TempPoint[]): TempPoint[] {
	if (points.length <= BOILER_HISTORY_JSON_SAMPLES) return points;
	return points.slice(points.length - BOILER_HISTORY_JSON_SAMPLES);
}

export async function withTimeoutFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
	let timer: NodeJS.Timeout | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((resolve) => {
				timer = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

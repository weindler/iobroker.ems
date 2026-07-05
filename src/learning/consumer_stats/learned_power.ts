import { MS_PER_DAY } from "../house_load/constants";
import { dateKeyToStartMs } from "../energy_daily_rollup/day";
import type { ConsumerPersistEntry } from "./types";

export const LEARNED_POWER_MIN_DAY_RUNTIME_SEC = 600;
export const LEARNED_POWER_LOOKBACK_DAYS = 60;
export const LEARNED_POWER_MIN_SAMPLE_DAYS = 3;

export type LearnedConsumerPower = {
	powerW: number;
	source: "config" | "learned";
	sampleDays: number;
	medianRuntimeSecPerDay: number | null;
};

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dayEffectivePowerW(runtimeSec: number, energyKwh: number): number | null {
	if (runtimeSec < LEARNED_POWER_MIN_DAY_RUNTIME_SEC || energyKwh <= 0) {
		return null;
	}
	const hours = runtimeSec / 3600;
	if (hours <= 0) return null;
	const w = (energyKwh * 1000) / hours;
	return Number.isFinite(w) && w > 0 ? w : null;
}

export function collectRecentDayMetrics(
	entry: ConsumerPersistEntry | undefined,
	nowMs: number,
	lookbackDays = LEARNED_POWER_LOOKBACK_DAYS,
): { powerWs: number[]; runtimeSecs: number[] } {
	if (!entry?.days) {
		return { powerWs: [], runtimeSecs: [] };
	}
	const cutoff = nowMs - lookbackDays * MS_PER_DAY;
	const powerWs: number[] = [];
	const runtimeSecs: number[] = [];
	for (const [dateKey, day] of Object.entries(entry.days)) {
		if (dateKeyToStartMs(dateKey) < cutoff) {
			continue;
		}
		if (day.runtimeSec < LEARNED_POWER_MIN_DAY_RUNTIME_SEC) {
			continue;
		}
		runtimeSecs.push(day.runtimeSec);
		const w = dayEffectivePowerW(day.runtimeSec, day.energyKwh);
		if (w !== null) {
			powerWs.push(w);
		}
	}
	return { powerWs, runtimeSecs };
}

/** Effektive Leistung: Median aus Stats-Tageswerten, sonst Admin-Config. */
export function resolveConsumerEffectivePowerW(
	entry: ConsumerPersistEntry | undefined,
	configPowerW: number,
	nowMs: number,
): LearnedConsumerPower {
	const safeConfig = configPowerW > 0 ? configPowerW : 0;
	const { powerWs, runtimeSecs } = collectRecentDayMetrics(entry, nowMs);
	const sampleDays = powerWs.length;
	const medianPower = median(powerWs);
	const medianRuntimeSecPerDay = median(runtimeSecs);
	if (sampleDays >= LEARNED_POWER_MIN_SAMPLE_DAYS && medianPower !== null && medianPower > 0) {
		return {
			powerW: Math.round(medianPower),
			source: "learned",
			sampleDays,
			medianRuntimeSecPerDay,
		};
	}
	return {
		powerW: safeConfig,
		source: "config",
		sampleDays,
		medianRuntimeSecPerDay,
	};
}

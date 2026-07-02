import { localDateKey } from "./day";
import type { DailyEnergyRecord, DayBuffer } from "./types";

export const PLAUSIBLE_DAY_KWH_MAX = 2000;

export function isValidDayKwh(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	return value > 0 && value <= PLAUSIBLE_DAY_KWH_MAX;
}

export function emptyDayBuffer(dateKey: string): DayBuffer {
	return {
		dateKey,
		kwh: 0,
		lastSampleTs: 0,
		sampleCount: 0,
	};
}

/** Monoton steigender Tageszähler: jeweils letzten gültigen Stand pro Tag behalten. */
export function ingestDailyKwhSample(buffer: DayBuffer, ts: number, rawKwh: number): DayBuffer {
	if (!isValidDayKwh(rawKwh)) {
		return buffer;
	}

	const dateKey = localDateKey(new Date(ts));
	let next = buffer;
	if (buffer.dateKey !== dateKey) {
		next = emptyDayBuffer(dateKey);
	}

	const rounded = Math.round(rawKwh * 1000) / 1000;
	if (next.sampleCount === 0 || ts >= next.lastSampleTs) {
		return {
			dateKey,
			kwh: rounded,
			lastSampleTs: ts,
			sampleCount: next.sampleCount + 1,
		};
	}

	return {
		...next,
		sampleCount: next.sampleCount + 1,
	};
}

export function bufferToDayRecord(buffer: DayBuffer): DailyEnergyRecord | null {
	if (buffer.sampleCount === 0 || !isValidDayKwh(buffer.kwh)) {
		return null;
	}
	return {
		dateKey: buffer.dateKey,
		kwh: buffer.kwh,
		lastSampleTs: buffer.lastSampleTs,
		sampleCount: buffer.sampleCount,
	};
}

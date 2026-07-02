import { MS_PER_DAY, MS_PER_HOUR } from "../house_load/constants";
import { calendarContext } from "../house_load/time";
import type { HouseLoadSample } from "../house_load/types";
import { MS_PER_DAY as BATTERY_MS_PER_DAY } from "../battery_runtime/constants";
import type { PowerPoint } from "../battery_runtime/types";
import { hourKeyToStartTs } from "./hour";
import { effectiveRollupMode, type PowerHourlyPersist, type PowerSourcePersist } from "./types";

function hourStartMs(ts: number): number {
	return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

export type RollupPowerMeta = {
	rawRows: number;
	normalizedRows: number;
	rawChargeSamples: number;
	rawDischargeSamples: number;
	hourlyChargePoints: number;
	hourlyDischargePoints: number;
	powerInvert: boolean;
	powerInvertAuto: boolean;
	powerHistoryMode: "ems_rollup";
};

export function findSourceByStateId(
	persist: PowerHourlyPersist,
	stateId: string,
): PowerSourcePersist | null {
	for (const source of Object.values(persist.sources)) {
		if (source.stateId === stateId) {
			return source;
		}
	}
	return null;
}

export function rollupSourceToPowerPoints(
	source: PowerSourcePersist,
	lookbackDays: number,
	nowMs = Date.now(),
): { points: PowerPoint[]; lastValidTs: number | null; meta: RollupPowerMeta } {
	const cutoff = nowMs - lookbackDays * BATTERY_MS_PER_DAY;
	const points: PowerPoint[] = [];
	let lastValidTs: number | null = null;
	let rawRows = 0;
	let rawChargeSamples = 0;
	let rawDischargeSamples = 0;
	let hourlyChargePoints = 0;
	let hourlyDischargePoints = 0;

	const hourKeys = Object.keys(source.hours).sort();
	for (const hourKey of hourKeys) {
		const rec = source.hours[hourKey];
		const ts = hourKeyToStartTs(hourKey);
		if (ts < cutoff) {
			continue;
		}
		rawRows += rec.sampleCount;
		rawChargeSamples += rec.chargeSamples;
		rawDischargeSamples += rec.dischargeSamples;

		if (rec.maxChargeW !== null) {
			const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
			points.push({ ts: sampleTs, powerW: rec.maxChargeW });
			hourlyChargePoints++;
			if (lastValidTs === null || sampleTs > lastValidTs) {
				lastValidTs = sampleTs;
			}
		}
		if (rec.maxDischargeW !== null) {
			const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
			points.push({ ts: sampleTs, powerW: -rec.maxDischargeW });
			hourlyDischargePoints++;
			if (lastValidTs === null || sampleTs > lastValidTs) {
				lastValidTs = sampleTs;
			}
		}
	}

	points.sort((a, b) => a.ts - b.ts);

	return {
		points,
		lastValidTs,
		meta: {
			rawRows,
			normalizedRows: rawRows,
			rawChargeSamples,
			rawDischargeSamples,
			hourlyChargePoints,
			hourlyDischargePoints,
			powerInvert: source.powerInvert,
			powerInvertAuto: false,
			powerHistoryMode: "ems_rollup",
		},
	};
}

export type RollupHouseLoadStats = {
	rowsTotal: number;
	validRows: number;
	hourlySamples: number;
	skippedInvalid: number;
	skippedNegative: number;
	tsSpanHours: number | null;
	historySource: "ems_rollup";
};

export function rollupSourceToHouseLoadSamples(
	source: PowerSourcePersist,
	lookbackDays: number,
	nowMs = Date.now(),
): { samples: HouseLoadSample[]; lastValidTs: number | null; stats: RollupHouseLoadStats } {
	const cutoff = nowMs - lookbackDays * MS_PER_DAY;
	const samples: HouseLoadSample[] = [];
	let lastValidTs: number | null = null;
	let rowsTotal = 0;
	let tsMin: number | null = null;
	let tsMax: number | null = null;

	const hourKeys = Object.keys(source.hours).sort();
	for (const hourKey of hourKeys) {
		const rec = source.hours[hourKey];
		const ts = hourKeyToStartTs(hourKey);
		if (ts < cutoff) {
			continue;
		}
		const avg = rec.avgPowerW;
		if (avg === null || avg === undefined) {
			continue;
		}
		rowsTotal += rec.sampleCount;
		const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
		if (tsMin === null || sampleTs < tsMin) tsMin = sampleTs;
		if (tsMax === null || sampleTs > tsMax) tsMax = sampleTs;
		if (lastValidTs === null || sampleTs > lastValidTs) {
			lastValidTs = sampleTs;
		}
		const d = new Date(sampleTs);
		const ctx = calendarContext(d);
		samples.push({
			ts: sampleTs,
			hourStartMs: hourStartMs(sampleTs),
			dateKey: ctx.dateKey,
			hourOfDay: ctx.hourOfDay,
			segment: ctx.segment,
			season: ctx.season,
			weekday: ctx.weekday,
			dayType: ctx.dayType,
			powerW: avg,
		});
	}

	samples.sort((a, b) => a.hourStartMs - b.hourStartMs);

	let tsSpanHours: number | null = null;
	if (tsMin !== null && tsMax !== null && tsMax > tsMin) {
		tsSpanHours = Math.round((tsMax - tsMin) / MS_PER_HOUR);
	}

	return {
		samples,
		lastValidTs,
		stats: {
			rowsTotal,
			validRows: samples.length,
			hourlySamples: samples.length,
			skippedInvalid: 0,
			skippedNegative: 0,
			tsSpanHours,
			historySource: "ems_rollup",
		},
	};
}

export function isBidirectionalRollupSource(source: PowerSourcePersist): boolean {
	return effectiveRollupMode(source) === "bidirectional_max";
}

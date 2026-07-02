import { MS_PER_DAY } from "../battery_runtime/constants";
import type { PowerPoint } from "../battery_runtime/types";
import { hourKeyToStartTs } from "./hour";
import type { PowerHourlyPersist, PowerSourcePersist } from "./types";

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
	const cutoff = nowMs - lookbackDays * MS_PER_DAY;
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

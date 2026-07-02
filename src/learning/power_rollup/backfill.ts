import {
	aggregatePowerPointsByHour,
	type BatteryHistoryHost,
} from "../battery_runtime/history";
import { MS_PER_DAY, MS_PER_HOUR } from "../house_load/constants";
import {
	fetchHistoryRowsAggregated,
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import { asNum } from "../../ems_light/state_util";
import { localHourKey } from "./hour";
import {
	mergeHourRecord,
	readPowerHourlyPersist,
	upsertSourcePersist,
	writePowerHourlyPersist,
} from "./persist";
import type { PowerHourlyRecord, ResolvedDensePowerSource } from "./types";

const MIN_BACKFILL_HOURS = 24;

export type PowerRollupBackfillHost = BatteryHistoryHost & {
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

function hourRecordFromBidirectional(
	hourKey: string,
	maxChargeW: number | null,
	maxDischargeW: number | null,
	lastSampleTs: number,
): PowerHourlyRecord {
	const chargeSamples = maxChargeW !== null ? 1 : 0;
	const dischargeSamples = maxDischargeW !== null ? 1 : 0;
	return {
		hourKey,
		sampleCount: chargeSamples + dischargeSamples,
		lastSampleTs,
		chargeSamples,
		dischargeSamples,
		maxChargeW,
		maxDischargeW,
	};
}

function hourRecordFromAvg(hourKey: string, avgPowerW: number, lastSampleTs: number): PowerHourlyRecord {
	return {
		hourKey,
		sampleCount: 1,
		lastSampleTs,
		chargeSamples: 0,
		dischargeSamples: 0,
		maxChargeW: null,
		maxDischargeW: null,
		sumPowerW: avgPowerW,
		avgPowerW,
	};
}

async function backfillBidirectional(
	host: PowerRollupBackfillHost,
	source: ResolvedDensePowerSource,
	lookbackDays: number,
): Promise<{ hours: Record<string, PowerHourlyRecord>; rows: number; hourlyChg: number; hourlyDis: number }> {
	const rows = await fetchHistoryRowsLookback(
		host,
		source.stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const { points, meta } = aggregatePowerPointsByHour(rows, source.powerInvert);

	const hours: Record<string, PowerHourlyRecord> = {};
	for (const point of points) {
		const hourKey = localHourKey(point.ts);
		const existingHour = hours[hourKey] ?? hourRecordFromBidirectional(hourKey, null, null, point.ts);
		if (point.powerW > 0) {
			existingHour.maxChargeW =
				existingHour.maxChargeW === null
					? point.powerW
					: Math.max(existingHour.maxChargeW, point.powerW);
			existingHour.chargeSamples = 1;
		} else {
			const magnitude = Math.abs(point.powerW);
			existingHour.maxDischargeW =
				existingHour.maxDischargeW === null
					? magnitude
					: Math.max(existingHour.maxDischargeW, magnitude);
			existingHour.dischargeSamples = 1;
		}
		existingHour.sampleCount = existingHour.chargeSamples + existingHour.dischargeSamples;
		existingHour.lastSampleTs = Math.max(existingHour.lastSampleTs, point.ts);
		hours[hourKey] = existingHour;
	}

	return {
		hours,
		rows: rows.length,
		hourlyChg: meta.hourlyChargePoints,
		hourlyDis: meta.hourlyDischargePoints,
	};
}

async function backfillUnidirectionalAvg(
	host: PowerRollupBackfillHost,
	source: ResolvedDensePowerSource,
	lookbackDays: number,
): Promise<{ hours: Record<string, PowerHourlyRecord>; rows: number; hourlyAvg: number }> {
	const endMs = Date.now();
	const startMs = endMs - lookbackDays * MS_PER_DAY;
	const aggregateRows = await fetchHistoryRowsAggregated(
		host,
		source.stateId,
		startMs,
		endMs,
		lookbackDays * 24 + 48,
		HISTORY_CHUNK_TIMEOUT_MS,
		"average",
		MS_PER_HOUR,
	);

	const hours: Record<string, PowerHourlyRecord> = {};
	let hourlyAvg = 0;
	for (const row of aggregateRows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const raw = asNum(row?.val);
		if (ts === null || raw === null || raw < 0) {
			continue;
		}
		let watts = raw;
		if (source.powerUnit === "kW") {
			watts = raw * 1000;
		} else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
			watts = raw * 1000;
		}
		if (!Number.isFinite(watts) || watts < 0 || watts > 50_000) {
			continue;
		}
		const hourKey = localHourKey(ts);
		const rec = hourRecordFromAvg(hourKey, Math.round(watts), ts);
		hours[hourKey] = mergeHourRecord(hours[hourKey], rec, "unidirectional_avg");
		hourlyAvg++;
	}

	if (hourlyAvg < Math.min(lookbackDays, 7)) {
		const rawRows = await fetchHistoryRowsLookback(
			host,
			source.stateId,
			lookbackDays,
			HISTORY_ROWS_PER_DAY,
			HISTORY_CHUNK_TIMEOUT_MS,
		);
		const byHour = new Map<string, { sum: number; count: number; lastTs: number }>();
		for (const row of rawRows) {
			const ts = typeof row?.ts === "number" ? row.ts : null;
			const raw = asNum(row?.val);
			if (ts === null || raw === null || raw < 0) {
				continue;
			}
			let watts = raw;
			if (source.powerUnit === "kW") {
				watts = raw * 1000;
			} else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
				watts = raw * 1000;
			}
			if (!Number.isFinite(watts) || watts < 0 || watts > 50_000) {
				continue;
			}
			const hourKey = localHourKey(ts);
			const bucket = byHour.get(hourKey) ?? { sum: 0, count: 0, lastTs: ts };
			bucket.sum += watts;
			bucket.count += 1;
			bucket.lastTs = Math.max(bucket.lastTs, ts);
			byHour.set(hourKey, bucket);
		}
		if (byHour.size > hourlyAvg) {
			const fromRaw: Record<string, PowerHourlyRecord> = {};
			for (const [hourKey, bucket] of byHour) {
				fromRaw[hourKey] = hourRecordFromAvg(
					hourKey,
					Math.round(bucket.sum / bucket.count),
					bucket.lastTs,
				);
			}
			return { hours: fromRaw, rows: rawRows.length, hourlyAvg: byHour.size };
		}
	}

	return { hours, rows: aggregateRows.length, hourlyAvg };
}

export async function backfillDensePowerSource(
	host: PowerRollupBackfillHost,
	source: ResolvedDensePowerSource,
): Promise<boolean> {
	const baseDir = host.getAbsolutePath?.("learning/power_rollup");
	if (!baseDir) {
		return false;
	}

	const lookbackDays = source.lookbackDays;

	let persist = await readPowerHourlyPersist(baseDir);
	const existing = persist.sources[source.sourceKey];
	if (existing?.backfillDone && Object.keys(existing.hours).length >= MIN_BACKFILL_HOURS) {
		return false;
	}

	host.log.info(
		`Power-Rollup backfill: ${source.sourceKey} (${lookbackDays}d, ${source.stateId})…`,
	);

	let mergedHours: Record<string, PowerHourlyRecord>;
	if (source.rollupMode === "unidirectional_avg") {
		const result = await backfillUnidirectionalAvg(host, source, lookbackDays);
		mergedHours = { ...(existing?.hours ?? {}) };
		for (const [key, rec] of Object.entries(result.hours)) {
			mergedHours[key] = mergeHourRecord(mergedHours[key], rec, "unidirectional_avg");
		}
		persist = upsertSourcePersist(persist, {
			sourceKey: source.sourceKey,
			stateId: source.stateId,
			rollupMode: source.rollupMode,
			powerInvert: source.powerInvert,
			powerUnit: source.powerUnit,
			backfillDone: true,
			hours: mergedHours,
		});
		await writePowerHourlyPersist(baseDir, persist);
		host.log.info(
			`Power-Rollup backfill done: ${source.sourceKey} history_rows=${result.rows} hourly_avg=${result.hourlyAvg} persisted_hours=${Object.keys(mergedHours).length}`,
		);
		return true;
	}

	const result = await backfillBidirectional(host, source, lookbackDays);
	mergedHours = { ...(existing?.hours ?? {}) };
	for (const [key, rec] of Object.entries(result.hours)) {
		mergedHours[key] = mergeHourRecord(mergedHours[key], rec, "bidirectional_max");
	}
	persist = upsertSourcePersist(persist, {
		sourceKey: source.sourceKey,
		stateId: source.stateId,
		rollupMode: source.rollupMode,
		powerInvert: source.powerInvert,
		powerUnit: source.powerUnit,
		backfillDone: true,
		hours: mergedHours,
	});
	await writePowerHourlyPersist(baseDir, persist);

	host.log.info(
		`Power-Rollup backfill done: ${source.sourceKey} history_rows=${result.rows} hourly_chg=${result.hourlyChg} hourly_dis=${result.hourlyDis} persisted_hours=${Object.keys(mergedHours).length}`,
	);
	return true;
}

export async function ensurePowerRollupBackfill(
	host: PowerRollupBackfillHost,
	sources: ResolvedDensePowerSource[],
): Promise<void> {
	for (const source of sources) {
		try {
			await backfillDensePowerSource(host, source);
		} catch (e) {
			host.log.warn(
				`Power-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
}

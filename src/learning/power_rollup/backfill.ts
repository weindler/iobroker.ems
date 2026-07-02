import {
	aggregatePowerPointsByHour,
	type BatteryHistoryHost,
} from "../battery_runtime/history";
import {
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import { localHourKey } from "./hour";
import {
	mergeHourRecord,
	readPowerHourlyPersist,
	upsertSourcePersist,
	writePowerHourlyPersist,
} from "./persist";
import type { ResolvedDensePowerSource } from "./types";

const MIN_BACKFILL_HOURS = 24;

export type PowerRollupBackfillHost = BatteryHistoryHost & {
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

function hourRecordFromAggregate(
	hourKey: string,
	maxChargeW: number | null,
	maxDischargeW: number | null,
	lastSampleTs: number,
) {
	const chargeSamples = maxChargeW !== null ? 1 : 0;
	const dischargeSamples = maxDischargeW !== null ? 1 : 0;
	return {
		hourKey,
		sampleCount: chargeSamples + dischargeSamples,
		chargeSamples,
		dischargeSamples,
		maxChargeW,
		maxDischargeW,
		lastSampleTs,
	};
}

export async function backfillDensePowerSource(
	host: PowerRollupBackfillHost,
	source: ResolvedDensePowerSource,
	lookbackDays: number,
): Promise<boolean> {
	const baseDir = host.getAbsolutePath?.("learning/power_rollup");
	if (!baseDir) {
		return false;
	}

	let persist = await readPowerHourlyPersist(baseDir);
	const existing = persist.sources[source.sourceKey];
	if (existing?.backfillDone && Object.keys(existing.hours).length >= MIN_BACKFILL_HOURS) {
		return false;
	}

	host.log.info(
		`Power-Rollup backfill: ${source.sourceKey} (${lookbackDays}d, ${source.stateId})…`,
	);

	const rows = await fetchHistoryRowsLookback(
		host,
		source.stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const { points, meta } = aggregatePowerPointsByHour(rows, source.powerInvert);

	const hours: Record<string, ReturnType<typeof hourRecordFromAggregate>> = {};
	for (const point of points) {
		const hourKey = localHourKey(point.ts);
		const existingHour = hours[hourKey] ?? {
			hourKey,
			sampleCount: 0,
			chargeSamples: 0,
			dischargeSamples: 0,
			maxChargeW: null as number | null,
			maxDischargeW: null as number | null,
			lastSampleTs: point.ts,
		};
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

	const mergedHours = { ...(existing?.hours ?? {}) };
	for (const [key, rec] of Object.entries(hours)) {
		mergedHours[key] = mergeHourRecord(mergedHours[key], rec);
	}

	persist = upsertSourcePersist(persist, {
		sourceKey: source.sourceKey,
		stateId: source.stateId,
		powerInvert: source.powerInvert,
		backfillDone: true,
		hours: mergedHours,
	});
	await writePowerHourlyPersist(baseDir, persist);

	host.log.info(
		`Power-Rollup backfill done: ${source.sourceKey} history_rows=${rows.length} hourly_chg=${meta.hourlyChargePoints} hourly_dis=${meta.hourlyDischargePoints} persisted_hours=${Object.keys(mergedHours).length}`,
	);
	return true;
}

export async function ensurePowerRollupBackfill(
	host: PowerRollupBackfillHost,
	sources: ResolvedDensePowerSource[],
	lookbackDays: number,
): Promise<void> {
	for (const source of sources) {
		try {
			await backfillDensePowerSource(host, source, lookbackDays);
		} catch (e) {
			host.log.warn(
				`Power-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
}

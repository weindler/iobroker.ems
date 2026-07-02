import { dayBoundsMs, fetchDayLastValue, type HistoryHost } from "../pv_bias/history";
import { localDateKey } from "../pv_bias/dates";
import {
	mergeDayRecord,
	readEnergyDailyPersist,
	upsertSourcePersist,
	writeEnergyDailyPersist,
} from "./persist";
import type { DailyEnergyRecord, ResolvedDailyEnergySource } from "./types";

const MIN_BACKFILL_DAYS = 7;

export type EnergyDailyBackfillHost = HistoryHost & {
	getAbsolutePath?: (category?: string) => string;
	log: { info: (msg: string) => void; warn: (msg: string) => void };
};

export async function backfillDailyEnergySource(
	host: EnergyDailyBackfillHost,
	source: ResolvedDailyEnergySource,
): Promise<boolean> {
	const baseDir = host.getAbsolutePath?.("learning/energy_daily_rollup");
	if (!baseDir) {
		return false;
	}

	let persist = await readEnergyDailyPersist(baseDir);
	const existing = persist.sources[source.sourceKey];
	if (existing?.backfillDone && Object.keys(existing.days).length >= MIN_BACKFILL_DAYS) {
		return false;
	}

	host.log.info(
		`Energy-Daily-Rollup backfill: ${source.sourceKey} (${source.lookbackDays}d, ${source.stateId})…`,
	);

	const mergedDays = { ...(existing?.days ?? {}) };
	for (let dayOffset = 1; dayOffset < source.lookbackDays; dayOffset++) {
		const { start, end } = dayBoundsMs(dayOffset);
		const dateKey = localDateKey(new Date(start));
		if (mergedDays[dateKey]?.kwh) {
			continue;
		}
		const last = await fetchDayLastValue(host, source.stateId, start, end);
		if (last === null || last <= 0) {
			continue;
		}
		const rec: DailyEnergyRecord = {
			dateKey,
			kwh: Math.round(last * 1000) / 1000,
			lastSampleTs: end - 60_000,
			sampleCount: 1,
		};
		mergedDays[dateKey] = mergeDayRecord(mergedDays[dateKey], rec);
	}

	persist = upsertSourcePersist(persist, {
		sourceKey: source.sourceKey,
		stateId: source.stateId,
		backfillDone: true,
		days: mergedDays,
	});
	await writeEnergyDailyPersist(baseDir, persist);

	host.log.info(
		`Energy-Daily-Rollup backfill done: ${source.sourceKey} persisted_days=${Object.keys(mergedDays).length}`,
	);
	return true;
}

export async function ensureEnergyDailyRollupBackfill(
	host: EnergyDailyBackfillHost,
	sources: ResolvedDailyEnergySource[],
): Promise<void> {
	for (const source of sources) {
		try {
			await backfillDailyEnergySource(host, source);
		} catch (e) {
			host.log.warn(
				`Energy-Daily-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
}

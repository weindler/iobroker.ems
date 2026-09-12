import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";

export const PV_BIAS_DAILY_FILENAME = "pv_bias_daily_v1.json";
export const PV_BIAS_DAILY_RETENTION_DAYS = 120;

export interface PvBiasDailyRecord {
	date: string;
	actualKwh: number | null;
	actualCapturedAt: string | null;
	forecastKwh: number | null;
	forecastCapturedAt: string | null;
	actualSource?: string;
	forecastSource?: string;
}

export interface PvBiasDailyPersist {
	version: 1;
	days: Record<string, PvBiasDailyRecord>;
}

export function emptyDailyPersist(): PvBiasDailyPersist {
	return { version: 1, days: {} };
}

export function pruneDailyPersist(
	persist: PvBiasDailyPersist,
	retainDays: number = PV_BIAS_DAILY_RETENTION_DAYS,
): PvBiasDailyPersist {
	if (!(retainDays > 0)) return persist;
	const keys = Object.keys(persist.days).sort();
	const keep = new Set(keys.slice(-Math.floor(retainDays)));
	const days: PvBiasDailyPersist["days"] = {};
	for (const key of keys) {
		if (keep.has(key)) days[key] = persist.days[key];
	}
	return { ...persist, days };
}

export async function readDailyPersist(baseDir: string): Promise<PvBiasDailyPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, PV_BIAS_DAILY_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as PvBiasDailyPersist;
		if (parsed?.version === 1 && parsed.days && typeof parsed.days === "object") {
			return parsed;
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyDailyPersist();
}

export async function writeDailyPersist(baseDir: string, persist: PvBiasDailyPersist): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const compacted = pruneDailyPersist(persist);
	await atomicWriteFile(
		path.join(baseDir, PV_BIAS_DAILY_FILENAME),
		`${JSON.stringify(compacted, null, 2)}\n`,
	);
}

export function upsertDailyRecord(
	persist: PvBiasDailyPersist,
	record: PvBiasDailyRecord,
): PvBiasDailyPersist {
	return {
		...persist,
		days: {
			...persist.days,
			[record.date]: {
				...persist.days[record.date],
				...record,
				date: record.date,
			},
		},
	};
}

export function dailyRecord(
	persist: PvBiasDailyPersist,
	dateKey: string,
): PvBiasDailyRecord | null {
	const row = persist.days[dateKey];
	if (!row) {
		return null;
	}
	return row;
}

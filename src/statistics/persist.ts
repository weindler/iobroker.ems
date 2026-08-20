import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	STATISTICS_PERSIST_VERSION,
	type StatisticsDayRecord,
	type StatisticsPersist,
} from "./types";
import { emptyHomeDay, emptyMobilityDay, localDateKey } from "./compute";

export const STATISTICS_PERSIST_FILE = "statistics_v1.json";
export const STATISTICS_PERSIST_CATEGORY = "statistics";

export function emptyRuntime(dateKey: string): StatisticsPersist["runtime"] {
	return {
		dateKey,
		lastTickMs: null,
		gridImportEnergyBaselineKwh: null,
		gridExportEnergyBaselineKwh: null,
		integratedDynamicCostEur: 0,
		integratedGridImportKwhFromPower: 0,
		wallboxSessionEnergyBaselineKwh: null,
		homePvKwh: 0,
		homeGridKwh: 0,
		homePvCostEur: 0,
		homeGridCostEur: 0,
		lastVehicleSocPct: null,
		lastWallboxConnected: null,
	};
}

export function emptyPersist(now = new Date()): StatisticsPersist {
	const dateKey = localDateKey(now);
	return {
		version: STATISTICS_PERSIST_VERSION,
		generatedAt: now.toISOString(),
		days: {},
		runtime: emptyRuntime(dateKey),
	};
}

export function emptyDayRecord(dateKey: string): StatisticsDayRecord {
	return {
		dateKey,
		home: emptyHomeDay(dateKey),
		mobility: emptyMobilityDay(dateKey),
		publicSessions: [],
	};
}

export async function readStatisticsPersist(dir: string): Promise<StatisticsPersist> {
	try {
		const raw = await readFile(join(dir, STATISTICS_PERSIST_FILE), "utf8");
		const parsed = JSON.parse(raw) as StatisticsPersist;
		if (!parsed || parsed.version !== STATISTICS_PERSIST_VERSION || !parsed.days) {
			return emptyPersist();
		}
		if (!parsed.runtime) {
			parsed.runtime = emptyRuntime(localDateKey(new Date()));
		}
		return parsed;
	} catch {
		return emptyPersist();
	}
}

export async function writeStatisticsPersist(dir: string, data: StatisticsPersist): Promise<void> {
	await mkdir(dir, { recursive: true });
	data.generatedAt = new Date().toISOString();
	await writeFile(join(dir, STATISTICS_PERSIST_FILE), JSON.stringify(data, null, 2), "utf8");
}

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
/** Buchhaltungs-Tageswerte: zehn Jahre, im Gegensatz zu 90/120 Tagen Detailtelemetrie. */
export const STATISTICS_DAILY_RETENTION_DAYS = 3_660;

function validDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Harte Obergrenze für den RAM-/SSD-Ledger. Noch nicht abgerechnete öffentliche
 * Ladesitzungen bleiben aus Datenintegritätsgründen auch jenseits des Cutoffs erhalten.
 */
export function pruneStatisticsPersist(
	data: StatisticsPersist,
	anchorDateKey: string,
	retainDays: number = STATISTICS_DAILY_RETENTION_DAYS,
): StatisticsPersist {
	if (!validDateKey(anchorDateKey) || !(retainDays > 0)) return data;
	const anchor = new Date(`${anchorDateKey}T12:00:00.000Z`);
	anchor.setUTCDate(anchor.getUTCDate() - (Math.floor(retainDays) - 1));
	const cutoff = anchor.toISOString().slice(0, 10);
	const days: StatisticsPersist["days"] = {};
	for (const [dateKey, day] of Object.entries(data.days)) {
		const pendingInvoice = day.publicSessions?.some((session) => session.status === "pending_invoice") === true;
		if (!validDateKey(dateKey) || dateKey >= cutoff || pendingInvoice) days[dateKey] = day;
	}
	const monthRewardsBilling: StatisticsPersist["monthRewardsBilling"] = {};
	for (const [monthKey, billing] of Object.entries(data.monthRewardsBilling ?? {})) {
		if (!/^\d{4}-\d{2}$/.test(monthKey) || monthKey >= cutoff.slice(0, 7)) {
			monthRewardsBilling[monthKey] = billing;
		}
	}
	return { ...data, days, monthRewardsBilling };
}

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
		meterCaptureSinceIso: null,
	};
}

export function emptyPersist(now = new Date()): StatisticsPersist {
	const dateKey = localDateKey(now);
	return {
		version: STATISTICS_PERSIST_VERSION,
		generatedAt: now.toISOString(),
		days: {},
		monthRewardsBilling: {},
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
		if (!parsed.monthRewardsBilling) {
			parsed.monthRewardsBilling = {};
		}
		return parsed;
	} catch {
		return emptyPersist();
	}
}

export async function writeStatisticsPersist(dir: string, data: StatisticsPersist): Promise<void> {
	await mkdir(dir, { recursive: true });
	const anchor = validDateKey(data.runtime.dateKey) ? data.runtime.dateKey : localDateKey(new Date());
	const compacted = pruneStatisticsPersist(data, anchor);
	/* Tick-Cache ebenfalls begrenzen; nicht erst nach Adapter-Neustart. */
	data.days = compacted.days;
	data.monthRewardsBilling = compacted.monthRewardsBilling;
	data.generatedAt = new Date().toISOString();
	await writeFile(join(dir, STATISTICS_PERSIST_FILE), JSON.stringify(data, null, 2), "utf8");
}

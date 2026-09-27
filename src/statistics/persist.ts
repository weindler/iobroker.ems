import { mkdir, readFile, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

export class UnsupportedStatisticsVersion extends Error {}

export function decodeStatistics(raw: string): StatisticsPersist {
	const parsed = JSON.parse(raw) as StatisticsPersist;
	if (!parsed || parsed.version !== STATISTICS_PERSIST_VERSION) {
		throw new UnsupportedStatisticsVersion("Unsupported statistics version; archive left unchanged");
	}
	if (!parsed.days || typeof parsed.days !== "object" || Array.isArray(parsed.days)) {
		throw new Error("Invalid statistics days");
	}
	for (const [key, day] of Object.entries(parsed.days)) {
		if (!validDateKey(key) || !day || day.dateKey !== key || !day.home || !day.mobility || !Array.isArray(day.publicSessions)) {
			throw new Error(`Invalid statistics day: ${key}`);
		}
	}
	parsed.runtime ??= emptyRuntime(localDateKey(new Date()));
	parsed.monthRewardsBilling ??= {};
	return parsed;
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Never truncate the only copy. Rename a flushed, same-directory temporary file. */
export async function atomicStatisticsWrite(path: string, raw: string): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(raw, "utf8");
		await handle.sync();
		await handle.close();
		await rename(temporary, path);
	} finally {
		await handle.close().catch(() => undefined);
		await unlink(temporary).catch((error: unknown) => { if (!isMissing(error)) throw error; });
	}
}

export async function readStatisticsPersist(dir: string): Promise<StatisticsPersist> {
	const path = join(dir, STATISTICS_PERSIST_FILE);
	let primaryError: unknown;
	try { return decodeStatistics(await readFile(path, "utf8")); }
	catch (error) {
		if (error instanceof UnsupportedStatisticsVersion) throw error;
		primaryError = error;
	}
	try { return decodeStatistics(await readFile(`${path}.bak`, "utf8")); }
	catch (error) {
		if (isMissing(primaryError) && isMissing(error)) return emptyPersist();
		throw new Error("Statistics cannot be recovered; refusing to replace history with empty data", { cause: error });
	}
}

export async function writeStatisticsPersist(dir: string, data: StatisticsPersist): Promise<void> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, STATISTICS_PERSIST_FILE);
	// Validate input before touching either durable copy. Historical days are not pruned.
	const generatedAt = new Date().toISOString();
	const raw = JSON.stringify({ ...data, generatedAt }, null, 2);
	decodeStatistics(raw);
	let previous: string | undefined;
	try {
		previous = await readFile(path, "utf8");
		decodeStatistics(previous);
	} catch (error) {
		if (error instanceof UnsupportedStatisticsVersion) throw error;
		if (!isMissing(error)) {
			// A corrupt primary must not replace a valid backup.
			previous = await readFile(`${path}.bak`, "utf8");
			decodeStatistics(previous);
		}
	}
	if (previous !== undefined) await atomicStatisticsWrite(`${path}.bak`, previous);
	await atomicStatisticsWrite(path, raw);
	data.generatedAt = generatedAt;
}

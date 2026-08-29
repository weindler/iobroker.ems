import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import {
	DAY_TELEMETRY_CATEGORY,
	DAY_TELEMETRY_MODULE,
	DAY_TELEMETRY_PERSIST_FILE,
	DAY_TELEMETRY_RETENTION_DAYS,
	DAY_TELEMETRY_SCHEMA,
	DAY_TELEMETRY_SLOT_MS,
} from "./constants";
import {
	emptyDayTelemetryStore,
	type DayTelemetryDayRecord,
	type DayTelemetryStore,
} from "./types";
import { addDaysToDateKey } from "../../operator/time";

export { DAY_TELEMETRY_CATEGORY };

export function normalizeDayTelemetryStore(raw: unknown): DayTelemetryStore | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.module !== DAY_TELEMETRY_MODULE || o.schemaVersion !== DAY_TELEMETRY_SCHEMA) return null;
	if (!o.days || typeof o.days !== "object") return null;
	return {
		module: DAY_TELEMETRY_MODULE,
		schemaVersion: DAY_TELEMETRY_SCHEMA,
		updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
		days: o.days as Record<string, DayTelemetryDayRecord>,
	};
}

export async function readDayTelemetryPersist(baseDir: string): Promise<DayTelemetryStore | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, DAY_TELEMETRY_PERSIST_FILE), "utf8");
		return normalizeDayTelemetryStore(JSON.parse(raw));
	} catch {
		return null;
	}
}

/** Kompakt ohne Pretty-Print — Größenbudget 90 Tage. */
export async function writeDayTelemetryPersist(
	baseDir: string,
	store: DayTelemetryStore,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(
		path.join(baseDir, DAY_TELEMETRY_PERSIST_FILE),
		`${JSON.stringify(store)}\n`,
	);
}

export async function loadOrEmptyDayTelemetryStore(
	baseDir: string | null | undefined,
): Promise<DayTelemetryStore> {
	if (!baseDir) return emptyDayTelemetryStore();
	return (await readDayTelemetryPersist(baseDir)) ?? emptyDayTelemetryStore();
}

/**
 * Rolling Retention: behält die letzten retainDays lokalen Kalendertage.
 * Älteste dateKeys zuerst droppen.
 */
export function pruneDayTelemetryStore(
	store: DayTelemetryStore,
	retainDays: number = DAY_TELEMETRY_RETENTION_DAYS,
	todayDateKey?: string,
): DayTelemetryStore {
	const keys = Object.keys(store.days).sort();
	if (keys.length <= retainDays) return store;
	let keep = keys;
	if (todayDateKey) {
		const cutoff = addDaysToDateKey(todayDateKey, -(retainDays - 1));
		keep = keys.filter((k) => k >= cutoff);
		/* Falls Filter zu aggressiv (Lücken): fallback auf letzte N */
		if (keep.length === 0) {
			keep = keys.slice(-retainDays);
		} else if (keep.length > retainDays) {
			keep = keep.slice(-retainDays);
		}
	} else {
		keep = keys.slice(-retainDays);
	}
	const keepSet = new Set(keep);
	const days: Record<string, DayTelemetryDayRecord> = {};
	for (const k of keys) {
		if (keepSet.has(k)) days[k] = store.days[k];
	}
	return {
		...store,
		days,
		updatedAtIso: new Date().toISOString(),
	};
}

export function dayTelemetryPersistPath(baseDir: string): string {
	return path.join(baseDir, DAY_TELEMETRY_PERSIST_FILE);
}

export function assertDayRecordSlotWidth(day: DayTelemetryDayRecord): boolean {
	return day.slotWidthMs === DAY_TELEMETRY_SLOT_MS;
}

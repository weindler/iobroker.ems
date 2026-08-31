/**
 * Tagesdatei-Persistenz für Day Telemetry (Schema 2).
 * Eine Datei pro lokalem Kalendertag: YYYY-MM-DD.json
 * Legacy-Monolith day_telemetry_v1.json wird einmalig migriert.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import { addDaysToDateKey } from "../../operator/time";
import {
	DAY_TELEMETRY_CATEGORY,
	DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT,
	DAY_TELEMETRY_LEGACY_MONOLITH_FILE,
	DAY_TELEMETRY_MODULE,
	DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER,
	DAY_TELEMETRY_RETENTION_DAYS,
	DAY_TELEMETRY_SCHEMA,
	DAY_TELEMETRY_SLOT_MS,
} from "./constants";
import {
	emptyDayRecord,
	emptyDayTelemetryStore,
	refreshDayCoverage,
	type DayTelemetryDayRecord,
	type DayTelemetryStore,
} from "./types";
import { compactForecastSnapshotsForPersist, rehydrateForecastRevisions } from "./forecast_horizon";

export { DAY_TELEMETRY_CATEGORY };

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dayTelemetryDayFileName(dateKey: string): string {
	return `${dateKey}.json`;
}

export function dayTelemetryDayPath(baseDir: string, dateKey: string): string {
	return path.join(baseDir, dayTelemetryDayFileName(dateKey));
}

/** @deprecated Monolith-Pfad — nur Migration/Inventar. */
export function dayTelemetryPersistPath(baseDir: string): string {
	return path.join(baseDir, DAY_TELEMETRY_LEGACY_MONOLITH_FILE);
}

function asCoverageFields(day: DayTelemetryDayRecord): DayTelemetryDayRecord {
	if (day.firstSampleMs === undefined) day.firstSampleMs = null;
	if (day.firstSampleIso === undefined) day.firstSampleIso = null;
	if (day.lastSampleMs === undefined) day.lastSampleMs = null;
	if (day.lastSampleIso === undefined) day.lastSampleIso = null;
	if (typeof day.observedSlotCount !== "number") day.observedSlotCount = 0;
	if (typeof day.coveragePct !== "number") day.coveragePct = 0;
	if (typeof day.evaluable !== "boolean") day.evaluable = false;
	/* Legacy Schema-1: qualityMask war number[] voller 0 (= falsch ok) */
	if (day.buckets?.qualityMask) {
		const qm = day.buckets.qualityMask as Array<number | null>;
		for (let i = 0; i < qm.length; i++) {
			/* Unbeobachtet: alle Energie-Buckets null und Maske 0 ohne Planner-Ref → null */
			if (qm[i] === 0 && day.buckets.plannedConsumersRef[i] == null) {
				const anyEnergy =
					day.buckets.pvKwh[i] != null ||
					day.buckets.houseTotalKwh[i] != null ||
					day.buckets.gridImportKwh[i] != null ||
					day.buckets.gridExportKwh[i] != null ||
					day.buckets.otherMeasuredConsumersKwh[i] != null ||
					day.buckets.batteryChargedKwh[i] != null ||
					day.buckets.gridBalanceDischargeKwh?.[i] != null ||
					day.buckets.priceCtPerKwh[i] != null;
				if (!anyEnergy) {
					qm[i] = null;
				}
			}
		}
	}
	refreshDayCoverage(day);
	return day;
}

export function normalizeDayRecord(raw: unknown, fallbackDateKey?: string): DayTelemetryDayRecord | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const dateKey =
		typeof o.dateKey === "string" && DATE_KEY_RE.test(o.dateKey)
			? o.dateKey
			: fallbackDateKey && DATE_KEY_RE.test(fallbackDateKey)
				? fallbackDateKey
				: null;
	if (!dateKey) return null;
	if (typeof o.slotCount !== "number" || typeof o.startMs !== "number" || typeof o.endMs !== "number") {
		return null;
	}
	const day = o as unknown as DayTelemetryDayRecord;
	day.dateKey = dateKey;
	if (!day.timezone) day.timezone = "Europe/Berlin";
	if (!day.slotWidthMs) day.slotWidthMs = DAY_TELEMETRY_SLOT_MS;
	if (!day.buckets) return null;
	const slotCount = day.slotCount;
	if (!Array.isArray(day.buckets.gridBalanceDischargeKwh) || day.buckets.gridBalanceDischargeKwh.length !== slotCount) {
		day.buckets.gridBalanceDischargeKwh = Array.from({ length: slotCount }, () => null);
	}
	if (!Array.isArray(day.forecastSnapshots)) day.forecastSnapshots = [];
	if (!Array.isArray(day.forecastRevisions)) day.forecastRevisions = [];
	rehydrateForecastRevisions(day);
	if (!Array.isArray(day.replanEvents)) day.replanEvents = [];
	if (!Array.isArray(day.climateRunSegments)) day.climateRunSegments = [];
	if (!Array.isArray(day.immersionRunSegments)) day.immersionRunSegments = [];
	if (!Array.isArray(day.statusEvents)) day.statusEvents = [];
	if (!Array.isArray(day.plannedConsumers)) day.plannedConsumers = [];
	if (typeof day.complete !== "boolean") day.complete = false;
	return asCoverageFields(day);
}

export async function readDayTelemetryDay(
	baseDir: string,
	dateKey: string,
): Promise<DayTelemetryDayRecord | null> {
	try {
		const raw = await fs.readFile(dayTelemetryDayPath(baseDir, dateKey), "utf8");
		const parsed = JSON.parse(raw) as unknown;
		/* Wrapper { day: ... } oder direkt DayRecord */
		const body =
			parsed && typeof parsed === "object" && "day" in (parsed as object)
				? (parsed as { day: unknown }).day
				: parsed;
		return normalizeDayRecord(body, dateKey);
	} catch {
		return null;
	}
}

export async function writeDayTelemetryDay(
	baseDir: string,
	day: DayTelemetryDayRecord,
): Promise<void> {
	refreshDayCoverage(day);
	/*
	 * Speicher-Kompaktierung (siehe forecast_horizon.ts): dedupliziert Preis-/PV-Horizonte
	 * über forecastSnapshots hinweg vor dem Serialisieren. `day` selbst (In-Memory-Dedup-Cache
	 * in record.ts) bleibt unverändert — compact() liefert ein neues Objekt.
	 */
	const compacted = compactForecastSnapshotsForPersist(day);
	const payload = {
		module: DAY_TELEMETRY_MODULE,
		schemaVersion: DAY_TELEMETRY_SCHEMA,
		updatedAtIso: new Date().toISOString(),
		day: compacted,
	};
	await atomicWriteFile(
		dayTelemetryDayPath(baseDir, day.dateKey),
		`${JSON.stringify(payload)}\n`,
		{ mode: DIAGNOSTIC_FILE_MODE },
	);
}

/** Additiv (Block A): Liste vorhandener Tagesdateien — rein lesend, keine Migration. */
export async function listDayTelemetryDateKeys(baseDir: string): Promise<string[]> {
	return listDayKeysOnDisk(baseDir);
}

async function listDayKeysOnDisk(baseDir: string): Promise<string[]> {
	try {
		const names = await fs.readdir(baseDir);
		return names
			.filter((n) => DATE_KEY_RE.test(n.replace(/\.json$/, "")) && n.endsWith(".json"))
			.map((n) => n.replace(/\.json$/, ""))
			.sort();
	} catch {
		return [];
	}
}

/**
 * Einmalmigration: Monolith days[] → Tagesdateien.
 * Idempotent via Marker-Datei. Keine Werte erfinden.
 */
export async function migrateMonolithToDayFiles(baseDir: string): Promise<{
	migrated: boolean;
	dayCount: number;
}> {
	const marker = path.join(baseDir, DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER);
	try {
		await fs.access(marker);
		return { migrated: false, dayCount: 0 };
	} catch {
		/* Marker fehlt → Migration prüfen */
	}

	await fs.mkdir(baseDir, { recursive: true });
	const monolithPath = path.join(baseDir, DAY_TELEMETRY_LEGACY_MONOLITH_FILE);
	let raw: string;
	try {
		raw = await fs.readFile(monolithPath, "utf8");
	} catch {
		await atomicWriteFile(marker, `${JSON.stringify({ migratedAtIso: new Date().toISOString(), dayCount: 0 })}\n`);
		return { migrated: false, dayCount: 0 };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		await fs.rename(monolithPath, `${monolithPath}.corrupt`).catch(() => undefined);
		await atomicWriteFile(marker, `${JSON.stringify({ migratedAtIso: new Date().toISOString(), corrupt: true })}\n`);
		return { migrated: false, dayCount: 0 };
	}

	const o = parsed as Record<string, unknown>;
	const daysObj =
		o.days && typeof o.days === "object" ? (o.days as Record<string, unknown>) : {};
	let dayCount = 0;
	for (const [dk, rawDay] of Object.entries(daysObj)) {
		if (!DATE_KEY_RE.test(dk)) continue;
		const existing = await readDayTelemetryDay(baseDir, dk);
		if (existing) continue; /* Tagesdatei hat Vorrang — keine Doppelmigration */
		const day = normalizeDayRecord(rawDay, dk);
		if (!day) continue;
		await writeDayTelemetryDay(baseDir, day);
		dayCount++;
	}

	const bak = `${monolithPath}.migrated`;
	await fs.rename(monolithPath, bak).catch(async () => {
		await fs.unlink(monolithPath).catch(() => undefined);
	});
	await atomicWriteFile(
		marker,
		`${JSON.stringify({ migratedAtIso: new Date().toISOString(), dayCount, backup: path.basename(bak) })}\n`,
	);
	return { migrated: true, dayCount };
}

export async function pruneDayTelemetryFiles(
	baseDir: string,
	retainDays: number = DAY_TELEMETRY_RETENTION_DAYS,
	todayDateKey?: string,
): Promise<string[]> {
	const keys = await listDayKeysOnDisk(baseDir);
	if (keys.length <= retainDays) return [];
	let keep = keys;
	if (todayDateKey) {
		const cutoff = addDaysToDateKey(todayDateKey, -(retainDays - 1));
		keep = keys.filter((k) => k >= cutoff);
		if (keep.length === 0) keep = keys.slice(-retainDays);
		else if (keep.length > retainDays) keep = keep.slice(-retainDays);
	} else {
		keep = keys.slice(-retainDays);
	}
	const keepSet = new Set(keep);
	const removed: string[] = [];
	for (const k of keys) {
		if (keepSet.has(k)) continue;
		await fs.unlink(dayTelemetryDayPath(baseDir, k)).catch(() => undefined);
		removed.push(k);
	}
	return removed;
}

/** In-Memory-Store aus Disk laden (für Tests / Cache-Hydration). */
export async function loadOrEmptyDayTelemetryStore(
	baseDir: string | null | undefined,
): Promise<DayTelemetryStore> {
	if (!baseDir) return emptyDayTelemetryStore();
	await migrateMonolithToDayFiles(baseDir);
	const store = emptyDayTelemetryStore();
	const keys = await listDayKeysOnDisk(baseDir);
	for (const dk of keys) {
		const day = await readDayTelemetryDay(baseDir, dk);
		if (day) store.days[dk] = day;
	}
	store.updatedAtIso = new Date().toISOString();
	return store;
}

/**
 * Schreibt alle Tage im Store als Tagesdateien (Tests / Vollpersist).
 * Produktion: bevorzugt writeDayTelemetryDay für den aktiven Tag.
 */
export async function writeDayTelemetryPersist(
	baseDir: string,
	store: DayTelemetryStore,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	for (const day of Object.values(store.days)) {
		await writeDayTelemetryDay(baseDir, day);
	}
}

/** @deprecated Kompatibilitätstests — liest alle Tagesdateien als Store. */
export async function readDayTelemetryPersist(baseDir: string): Promise<DayTelemetryStore | null> {
	const store = await loadOrEmptyDayTelemetryStore(baseDir);
	if (Object.keys(store.days).length === 0) {
		/* leeres Dir ohne Marker/Dateien */
		try {
			await fs.access(baseDir);
		} catch {
			return null;
		}
	}
	return store;
}

/** In-Memory Retention (Cache); Dateien separat via pruneDayTelemetryFiles. */
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
		if (keep.length === 0) keep = keys.slice(-retainDays);
		else if (keep.length > retainDays) keep = keep.slice(-retainDays);
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

export function assertDayRecordSlotWidth(day: DayTelemetryDayRecord): boolean {
	return day.slotWidthMs === DAY_TELEMETRY_SLOT_MS;
}

export function normalizeDayTelemetryStore(raw: unknown): DayTelemetryStore | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.module !== DAY_TELEMETRY_MODULE) return null;
	if (!o.days || typeof o.days !== "object") return null;
	const days: Record<string, DayTelemetryDayRecord> = {};
	for (const [dk, v] of Object.entries(o.days as Record<string, unknown>)) {
		const day = normalizeDayRecord(v, dk);
		if (day) days[dk] = day;
	}
	return {
		module: DAY_TELEMETRY_MODULE,
		schemaVersion: DAY_TELEMETRY_SCHEMA,
		updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
		days,
	};
}

export { DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT };

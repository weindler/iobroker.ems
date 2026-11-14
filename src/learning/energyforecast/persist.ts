import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import type { EfSnapshot } from "./compare";
import type { DayHourBias } from "./bias_model";
import { localDay, type EfParsed, type EfSlot } from "./parse";

export const EF_CACHE_FILE = "cache_v1.json";
export const EF_SNAPSHOT_FILE = "snapshots_v1.json";
export const EF_BIAS_FILE = "bias_history_v1.json";
export const SNAPSHOT_RETENTION_MS = 16 * 86_400_000;
export const ACTUAL_RETENTION_MS = 30 * 86_400_000;

export type EfCache = {
	version: 1;
	fetchedAtIso: string | null;
	/** Letzter Abrufversuch (auch fehlgeschlagen) — steuert Wiederholungen. */
	lastAttemptMs: number;
	lastError: string | null;
	lastErrorStatus: number | null;
	plan: string | null;
	generatedAtIso: string | null;
	validUntilIso: string | null;
	slots: EfSlot[];
};

export type EfSnapshotFile = {
	version: 1;
	snapshots: EfSnapshot[];
	/** startMs -> echter Preis (total_ct_kwh), aus Slots mit price_origin "market". */
	actual: Record<string, number>;
};

export function emptyCache(): EfCache {
	return {
		version: 1,
		fetchedAtIso: null,
		lastAttemptMs: 0,
		lastError: null,
		lastErrorStatus: null,
		plan: null,
		generatedAtIso: null,
		validUntilIso: null,
		slots: [],
	};
}

export function emptySnapshotFile(): EfSnapshotFile {
	return { version: 1, snapshots: [], actual: {} };
}

async function readJson<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await fs.readFile(file, "utf8")) as T;
	} catch {
		return null;
	}
}

export async function readCache(dir: string): Promise<EfCache> {
	const c = await readJson<EfCache>(path.join(dir, EF_CACHE_FILE));
	return c && c.version === 1 && Array.isArray(c.slots) ? c : emptyCache();
}

export async function writeCache(dir: string, cache: EfCache): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteFile(path.join(dir, EF_CACHE_FILE), `${JSON.stringify(cache)}\n`);
}

export async function readSnapshots(dir: string): Promise<EfSnapshotFile> {
	const s = await readJson<EfSnapshotFile>(path.join(dir, EF_SNAPSHOT_FILE));
	return s && s.version === 1 && Array.isArray(s.snapshots) && s.actual ? s : emptySnapshotFile();
}

export async function writeSnapshots(dir: string, file: EfSnapshotFile): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteFile(path.join(dir, EF_SNAPSHOT_FILE), `${JSON.stringify(file)}\n`);
}

export async function readBiasHistory(dir: string): Promise<DayHourBias[]> {
	const f = await readJson<{ version: 1; entries: DayHourBias[] }>(path.join(dir, EF_BIAS_FILE));
	return f && f.version === 1 && Array.isArray(f.entries) ? f.entries : [];
}

export async function writeBiasHistory(dir: string, entries: DayHourBias[]): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteFile(path.join(dir, EF_BIAS_FILE), `${JSON.stringify({ version: 1, entries })}\n`);
}

function sameSlots(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i][0] !== b[i][0] || Math.abs(a[i][1] - b[i][1]) > 1e-6) return false;
	}
	return true;
}

/**
 * Neuen Abruf einarbeiten: Prognose-Slots als Snapshot festhalten (nur wenn sich etwas geändert hat),
 * Markt-Slots als echte Preise ablegen, Altes entfernen. Rein, gibt neue Datei zurück.
 */
export function addFetchToSnapshots(file: EfSnapshotFile, parsed: EfParsed, nowMs: number): EfSnapshotFile {
	const actual = { ...file.actual };
	for (const s of parsed.slots) if (s.origin === "market") actual[String(s.startMs)] = s.totalCt;

	const fc: Array<[number, number]> = parsed.slots
		.filter((s) => s.origin === "forecast" && s.startMs > nowMs - 15 * 60_000)
		.map((s) => [s.startMs, s.totalCt]);
	let snapshots = file.snapshots;
	const last = snapshots[snapshots.length - 1];
	if (fc.length > 0 && !(last && sameSlots(last.slots, fc))) {
		snapshots = [...snapshots, { atMs: nowMs, slots: fc }];
	}
	snapshots = snapshots.filter((s) => nowMs - s.atMs <= SNAPSHOT_RETENTION_MS);
	for (const key of Object.keys(actual)) {
		if (nowMs - Number(key) > ACTUAL_RETENTION_MS) delete actual[key];
	}
	return { version: 1, snapshots, actual };
}

export { localDay };

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import {
	DAY_EVAL_MODULE,
	DAY_EVAL_PERSIST_FILE,
	DAY_EVAL_RETENTION_DAYS,
	DAY_EVAL_SCHEMA,
	emptyDayEvaluationStore,
	type DayEvaluationRecord,
	type DayEvaluationStore,
} from "./types";

export function normalizeDayEvaluationStore(raw: unknown): DayEvaluationStore | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.module !== DAY_EVAL_MODULE || o.schemaVersion !== DAY_EVAL_SCHEMA) return null;
	if (!o.days || typeof o.days !== "object") return null;
	return {
		module: DAY_EVAL_MODULE,
		schemaVersion: DAY_EVAL_SCHEMA,
		updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
		days: o.days as Record<string, DayEvaluationRecord>,
	};
}

export async function readDayEvaluationPersist(baseDir: string): Promise<DayEvaluationStore | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, DAY_EVAL_PERSIST_FILE), "utf8");
		return normalizeDayEvaluationStore(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function writeDayEvaluationPersist(
	baseDir: string,
	store: DayEvaluationStore,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	await atomicWriteFile(
		path.join(baseDir, DAY_EVAL_PERSIST_FILE),
		`${JSON.stringify(store, null, 2)}\n`,
	);
}

export async function loadOrEmptyDayEvaluationStore(
	baseDir: string | null | undefined,
): Promise<DayEvaluationStore> {
	if (!baseDir) return emptyDayEvaluationStore();
	return (await readDayEvaluationPersist(baseDir)) ?? emptyDayEvaluationStore();
}

/** Rollierende Retention — älteste Tage zuerst entfernen. */
export function pruneDayEvaluationStore(
	store: DayEvaluationStore,
	retainDays: number = DAY_EVAL_RETENTION_DAYS,
	nowMs: number = Date.now(),
): DayEvaluationStore {
	const keys = Object.keys(store.days).sort();
	if (keys.length <= retainDays) return store;
	const drop = keys.slice(0, keys.length - retainDays);
	const days = { ...store.days };
	for (const k of drop) delete days[k];
	void nowMs;
	return { ...store, days, updatedAtIso: new Date().toISOString() };
}

/**
 * Idempotenter Upsert: existiert der Tag bereits → unverändert zurückgeben (closed).
 * Returns { store, inserted }.
 */
export function upsertDayEvaluationOnce(
	store: DayEvaluationStore,
	record: DayEvaluationRecord,
): { store: DayEvaluationStore; inserted: boolean } {
	if (store.days[record.plan.date]) {
		return { store, inserted: false };
	}
	const next: DayEvaluationStore = {
		...store,
		updatedAtIso: record.evaluatedAtIso,
		days: { ...store.days, [record.plan.date]: record },
	};
	return { store: pruneDayEvaluationStore(next), inserted: true };
}

export function dayEvaluationExists(store: DayEvaluationStore, date: string): boolean {
	return store.days[date] != null;
}

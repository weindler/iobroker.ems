import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import { addDaysToDateKey } from "../../operator/time";
import { SHADOW_ENGINE_RETENTION_DAYS } from "./constants";
import type { ShadowDayRecord } from "./types";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayFilePath(baseDir: string, dateKey: string): string {
	return path.join(baseDir, `${dateKey}.json`);
}

export async function writeShadowDayRecord(baseDir: string, record: ShadowDayRecord): Promise<void> {
	await atomicWriteFile(dayFilePath(baseDir, record.dateKey), `${JSON.stringify(record)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}

export async function readShadowDayRecord(
	baseDir: string,
	dateKey: string,
): Promise<ShadowDayRecord | null> {
	try {
		const raw = await fs.readFile(dayFilePath(baseDir, dateKey), "utf8");
		return JSON.parse(raw) as ShadowDayRecord;
	} catch {
		return null;
	}
}

async function listDayKeysOnDisk(baseDir: string): Promise<string[]> {
	try {
		const names = await fs.readdir(baseDir);
		return names
			.filter((n) => n.endsWith(".json") && DATE_KEY_RE.test(n.replace(/\.json$/, "")))
			.map((n) => n.replace(/\.json$/, ""))
			.sort();
	} catch {
		return [];
	}
}

export async function listShadowEvaluatedDateKeys(baseDir: string): Promise<Set<string>> {
	return new Set(await listDayKeysOnDisk(baseDir));
}

export async function pruneShadowEngineFiles(
	baseDir: string,
	todayDateKey?: string,
	retainDays: number = SHADOW_ENGINE_RETENTION_DAYS,
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
		await fs.unlink(dayFilePath(baseDir, k)).catch(() => undefined);
		removed.push(k);
	}
	return removed;
}

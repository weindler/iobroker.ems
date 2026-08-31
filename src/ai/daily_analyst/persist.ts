/**
 * Persistenz analog `daily_evaluator/persist.ts`: ein kleines JSON pro Tag (support_only —
 * rebuildable durch erneuten KI-Lauf mit denselben Eingabedaten, kein Backup-Anspruch).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import { addDaysToDateKey } from "../../operator/time";
import type { AiAnalystFinding, AiAnalystRunResult } from "./types";

export const AI_ANALYST_MODULE = "ai_daily_analyst" as const;
export const AI_ANALYST_SCHEMA_VERSION = 1 as const;
export const AI_ANALYST_FINDINGS_CATEGORY = "ai/daily_analyst/findings";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

type AiAnalystDayFile = {
	module: typeof AI_ANALYST_MODULE;
	schemaVersion: typeof AI_ANALYST_SCHEMA_VERSION;
	dateKey: string;
	generatedAtIso: string;
	status: AiAnalystRunResult["status"];
	reasonDe: string;
	model: string;
	findings: AiAnalystFinding[];
};

function dayFilePath(baseDir: string, dateKey: string): string {
	return path.join(baseDir, `${dateKey}.json`);
}

export async function writeAiAnalystDay(
	baseDir: string,
	dateKey: string,
	data: { status: AiAnalystRunResult["status"]; reasonDe: string; model: string; findings: AiAnalystFinding[] },
): Promise<void> {
	const payload: AiAnalystDayFile = {
		module: AI_ANALYST_MODULE,
		schemaVersion: AI_ANALYST_SCHEMA_VERSION,
		dateKey,
		generatedAtIso: new Date().toISOString(),
		status: data.status,
		reasonDe: data.reasonDe,
		model: data.model,
		findings: data.findings,
	};
	await atomicWriteFile(dayFilePath(baseDir, dateKey), `${JSON.stringify(payload)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}

export async function readAiAnalystDay(baseDir: string, dateKey: string): Promise<AiAnalystDayFile | null> {
	try {
		const raw = await fs.readFile(dayFilePath(baseDir, dateKey), "utf8");
		const parsed = JSON.parse(raw) as Partial<AiAnalystDayFile>;
		if (!parsed || parsed.module !== AI_ANALYST_MODULE) return null;
		return parsed as AiAnalystDayFile;
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

export async function pruneAiAnalystFindings(
	baseDir: string,
	retainDays: number,
	todayDateKey?: string,
): Promise<string[]> {
	const keys = await listDayKeysOnDisk(baseDir);
	if (keys.length <= retainDays) return [];
	let keep = keys;
	if (todayDateKey) {
		const cutoff = addDaysToDateKey(todayDateKey, -(retainDays - 1));
		keep = keys.filter((k) => k >= cutoff);
		if (keep.length === 0) keep = keys.slice(-retainDays);
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

/**
 * BLOCK A — Persistenz. Getrennt von day_telemetry (eigene Kategorien):
 *   findings/YYYY-MM-DD.json  (support_only, rebuildable aus Telemetrie)
 *   scores/YYYY-MM-DD.json    (support_only, rebuildable aus Telemetrie)
 *   learning_state_v1.json    (restorewürdig — einziger Block-A-State mit Backup-Anspruch)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import { addDaysToDateKey } from "../../operator/time";
import {
	DAILY_EVALUATOR_LEARNING_STATE_FILE,
	DAILY_EVALUATOR_MODULE,
	DAILY_EVALUATOR_RETENTION_DAYS,
	DAILY_EVALUATOR_SCHEMA_VERSION,
} from "./constants";
import {
	emptyDailyEvaluatorLearningState,
	type DailyEvaluatorLearningState,
	type EvaluationRecord,
	type EvaluatorFinding,
} from "./types";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayFilePath(baseDir: string, dateKey: string): string {
	return path.join(baseDir, `${dateKey}.json`);
}

export async function writeFindingsDay(
	findingsBaseDir: string,
	dateKey: string,
	findings: EvaluatorFinding[],
): Promise<void> {
	const payload = {
		module: DAILY_EVALUATOR_MODULE,
		schemaVersion: DAILY_EVALUATOR_SCHEMA_VERSION,
		dateKey,
		findings,
	};
	await atomicWriteFile(dayFilePath(findingsBaseDir, dateKey), `${JSON.stringify(payload)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}

export async function readFindingsDay(
	findingsBaseDir: string,
	dateKey: string,
): Promise<EvaluatorFinding[] | null> {
	try {
		const raw = await fs.readFile(dayFilePath(findingsBaseDir, dateKey), "utf8");
		const parsed = JSON.parse(raw) as { findings?: unknown };
		return Array.isArray(parsed.findings) ? (parsed.findings as EvaluatorFinding[]) : [];
	} catch {
		return null;
	}
}

export async function writeScoresDay(scoresBaseDir: string, record: EvaluationRecord): Promise<void> {
	const payload = {
		module: DAILY_EVALUATOR_MODULE,
		schemaVersion: DAILY_EVALUATOR_SCHEMA_VERSION,
		dateKey: record.dateKey,
		record,
	};
	await atomicWriteFile(dayFilePath(scoresBaseDir, record.dateKey), `${JSON.stringify(payload)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}

export async function readScoresDay(
	scoresBaseDir: string,
	dateKey: string,
): Promise<EvaluationRecord | null> {
	try {
		const raw = await fs.readFile(dayFilePath(scoresBaseDir, dateKey), "utf8");
		const parsed = JSON.parse(raw) as { record?: unknown };
		return (parsed.record as EvaluationRecord | undefined) ?? null;
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

async function pruneDir(
	baseDir: string,
	retainDays: number,
	todayDateKey: string | undefined,
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

export async function pruneDailyEvaluatorFiles(
	findingsBaseDir: string,
	scoresBaseDir: string,
	todayDateKey?: string,
	retainDays: number = DAILY_EVALUATOR_RETENTION_DAYS,
): Promise<{ removedFindings: string[]; removedScores: string[] }> {
	const removedFindings = await pruneDir(findingsBaseDir, retainDays, todayDateKey);
	const removedScores = await pruneDir(scoresBaseDir, retainDays, todayDateKey);
	return { removedFindings, removedScores };
}

export async function listEvaluatedDateKeys(scoresBaseDir: string): Promise<Set<string>> {
	const keys = await listDayKeysOnDisk(scoresBaseDir);
	return new Set(keys);
}

function normalizeLearningState(raw: unknown): DailyEvaluatorLearningState | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.module !== DAILY_EVALUATOR_MODULE) return null;
	const empty = emptyDailyEvaluatorLearningState();
	return {
		...empty,
		...o,
		module: DAILY_EVALUATOR_MODULE,
		schemaVersion: DAILY_EVALUATOR_SCHEMA_VERSION,
	} as DailyEvaluatorLearningState;
}

export function learningStatePath(baseDir: string): string {
	return path.join(baseDir, DAILY_EVALUATOR_LEARNING_STATE_FILE);
}

export async function loadDailyEvaluatorLearningState(
	baseDir: string | null | undefined,
): Promise<DailyEvaluatorLearningState> {
	if (!baseDir) return emptyDailyEvaluatorLearningState();
	try {
		const raw = await fs.readFile(learningStatePath(baseDir), "utf8");
		const parsed = normalizeLearningState(JSON.parse(raw));
		return parsed ?? emptyDailyEvaluatorLearningState();
	} catch {
		return emptyDailyEvaluatorLearningState();
	}
}

export async function writeDailyEvaluatorLearningState(
	baseDir: string,
	state: DailyEvaluatorLearningState,
): Promise<void> {
	await atomicWriteFile(learningStatePath(baseDir), `${JSON.stringify(state)}\n`, {
		mode: DIAGNOSTIC_FILE_MODE,
	});
}

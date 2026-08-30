import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addDaysToDateKey } from "../../operator/time.js";
import { makeFinding } from "./test_helpers.js";
import {
	learningStatePath,
	listEvaluatedDateKeys,
	loadDailyEvaluatorLearningState,
	pruneDailyEvaluatorFiles,
	readFindingsDay,
	readScoresDay,
	writeDailyEvaluatorLearningState,
	writeFindingsDay,
	writeScoresDay,
} from "./persist.js";
import { emptyDailyEvaluatorLearningState, type EvaluationRecord } from "./types.js";

function baseRecord(dateKey: string): EvaluationRecord {
	return {
		evaluatorSchemaVersion: 1,
		sourceTelemetrySchemaVersion: 1,
		sourceUpdatedAtIso: `${dateKey}T23:00:00.000Z`,
		dateKey,
		timezone: "Europe/Berlin",
		evaluatedAtIso: `${dateKey}T23:30:00.000Z`,
		dayComplete: true,
		dayEvaluable: true,
		dayCoveragePct: 100,
		eligibility: [],
		findingsCount: 0,
		findingsByDomain: { battery: 0, thermal: 0, climate: 0, ev: 0 },
		scores: [],
		globalScore: null,
		globalScoreWeights: {},
	};
}

async function withTempDirs<T>(fn: (findingsDir: string, scoresDir: string, learningDir: string) => Promise<T>): Promise<T> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-"));
	try {
		const findingsDir = path.join(root, "findings");
		const scoresDir = path.join(root, "scores");
		await fs.mkdir(findingsDir, { recursive: true });
		await fs.mkdir(scoresDir, { recursive: true });
		return await fn(findingsDir, scoresDir, root);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

describe("daily_evaluator persist", () => {
	it("findings/scores atomic write roundtrip", async () => {
		await withTempDirs(async (findingsDir, scoresDir) => {
			const findings = [makeFinding({ dateKey: "2026-06-15" })];
			await writeFindingsDay(findingsDir, "2026-06-15", findings);
			const loadedFindings = await readFindingsDay(findingsDir, "2026-06-15");
			assert.equal(loadedFindings?.length, 1);
			assert.equal(loadedFindings?.[0].id, findings[0].id);

			const record = baseRecord("2026-06-15");
			await writeScoresDay(scoresDir, record);
			const loadedRecord = await readScoresDay(scoresDir, "2026-06-15");
			assert.equal(loadedRecord?.dateKey, "2026-06-15");
			assert.equal(loadedRecord?.evaluatorSchemaVersion, 1);
		});
	});

	it("readFindingsDay/readScoresDay: nicht vorhandener Tag → null (kein Fehler)", async () => {
		await withTempDirs(async (findingsDir, scoresDir) => {
			assert.equal(await readFindingsDay(findingsDir, "2026-06-15"), null);
			assert.equal(await readScoresDay(scoresDir, "2026-06-15"), null);
		});
	});

	it("pruneDailyEvaluatorFiles: 91 Tage → ältester wird entfernt, Retention 90", async () => {
		await withTempDirs(async (findingsDir, scoresDir) => {
			const start = "2026-01-01";
			for (let i = 0; i < 91; i++) {
				const dk = addDaysToDateKey(start, i);
				await writeFindingsDay(findingsDir, dk, []);
				await writeScoresDay(scoresDir, baseRecord(dk));
			}
			const today = addDaysToDateKey(start, 90);
			const { removedFindings, removedScores } = await pruneDailyEvaluatorFiles(findingsDir, scoresDir, today, 90);
			assert.deepEqual(removedFindings, [start]);
			assert.deepEqual(removedScores, [start]);

			const remaining = await listEvaluatedDateKeys(scoresDir);
			assert.equal(remaining.size, 90);
			assert.ok(!remaining.has(start));
			assert.ok(remaining.has(today));
		});
	});

	it("pruneDailyEvaluatorFiles: unter Retention-Grenze → keine Löschung", async () => {
		await withTempDirs(async (findingsDir, scoresDir) => {
			await writeFindingsDay(findingsDir, "2026-06-15", []);
			await writeScoresDay(scoresDir, baseRecord("2026-06-15"));
			const { removedFindings, removedScores } = await pruneDailyEvaluatorFiles(findingsDir, scoresDir, "2026-06-15", 90);
			assert.deepEqual(removedFindings, []);
			assert.deepEqual(removedScores, []);
		});
	});

	it("listEvaluatedDateKeys: liefert nur tatsächlich vorhandene YYYY-MM-DD Score-Dateien", async () => {
		await withTempDirs(async (findingsDir, scoresDir) => {
			await writeScoresDay(scoresDir, baseRecord("2026-06-14"));
			await writeScoresDay(scoresDir, baseRecord("2026-06-15"));
			const keys = await listEvaluatedDateKeys(scoresDir);
			assert.deepEqual([...keys].sort(), ["2026-06-14", "2026-06-15"]);
		});
	});

	it("learning_state_v1.json: fehlende Datei → emptyDailyEvaluatorLearningState (kein Fehler)", async () => {
		await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
			const state = await loadDailyEvaluatorLearningState(learningDir);
			assert.deepEqual(state, { ...emptyDailyEvaluatorLearningState(), updatedAtIso: state.updatedAtIso });
			assert.equal(state.lastProcessedDateKey, null);
		});
	});

	it("learning_state_v1.json: write/load roundtrip, restorewürdig unter fixem Dateinamen", async () => {
		await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
			const state = emptyDailyEvaluatorLearningState();
			state.lastProcessedDateKey = "2026-06-15";
			await writeDailyEvaluatorLearningState(learningDir, state);

			const filePath = learningStatePath(learningDir);
			assert.equal(path.basename(filePath), "learning_state_v1.json");

			const loaded = await loadDailyEvaluatorLearningState(learningDir);
			assert.equal(loaded.lastProcessedDateKey, "2026-06-15");
			assert.equal(loaded.module, "daily_evaluator");
		});
	});

	it("normalizeLearningState: Fremd-JSON ohne module-Feld wird verworfen → empty state statt Fehlinterpretation", async () => {
		await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
			await fs.writeFile(learningStatePath(learningDir), JSON.stringify({ foo: "bar" }));
			const loaded = await loadDailyEvaluatorLearningState(learningDir);
			assert.equal(loaded.lastProcessedDateKey, null);
			assert.equal(loaded.module, "daily_evaluator");
		});
	});
});

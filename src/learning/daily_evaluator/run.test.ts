import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addDaysToDateKey } from "../../operator/time.js";
import { DAY_TELEMETRY_CATEGORY } from "../day_telemetry/constants.js";
import { writeDayTelemetryDay } from "../day_telemetry/persist.js";
import { freshDay } from "./test_helpers.js";
import {
	DAILY_EVALUATOR_SCORES_CATEGORY,
	DAILY_EVALUATOR_STATE_CATEGORY,
	DAILY_EVALUATOR_STATES,
} from "./constants.js";
import { readScoresDay } from "./persist.js";
import { runDailyEvaluatorBatch, type DailyEvaluatorHost } from "./run.js";

function makeHost(root: string): DailyEvaluatorHost & { states: Map<string, ioBroker.StateValue> } {
	const states = new Map<string, ioBroker.StateValue>();
	return {
		states,
		getAbsolutePath: (category?: string) => path.join(root, category ?? "root"),
		setStateAsync: async (id, state) => {
			states.set(id, (state as { val: ioBroker.StateValue }).val);
		},
	};
}

async function completeDay(dateKey: string): Promise<ReturnType<typeof freshDay>> {
	const day = freshDay(dateKey);
	day.complete = true;
	day.lastSampleIso = `${dateKey}T22:00:00.000Z`;
	return day;
}

describe("daily_evaluator run (Batch-Trigger)", () => {
	it("Backlog: mehrere unevaluierte, vollständige Tage werden chronologisch nachgearbeitet (Korrektur #11)", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });

			const days = ["2026-06-13", "2026-06-14", "2026-06-15"];
			for (const dk of days) {
				await writeDayTelemetryDay(telemetryDir, await completeDay(dk));
			}

			const host = makeHost(root);
			const result = await runDailyEvaluatorBatch(host, { now: new Date("2026-06-16T03:00:00.000Z") });

			assert.deepEqual(result.processedDateKeys, days);
			assert.deepEqual(result.errors, []);
			assert.equal(host.states.get(DAILY_EVALUATOR_STATES.status), "ok");
			assert.equal(host.states.get(DAILY_EVALUATOR_STATES.lastEvaluatedDateKey), "2026-06-15");

			const scoresDir = path.join(root, DAILY_EVALUATOR_SCORES_CATEGORY);
			for (const dk of days) {
				const record = await readScoresDay(scoresDir, dk);
				assert.equal(record?.dateKey, dk);
			}
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("Idempotenz: zweiter Lauf ohne neue Tage verarbeitet nichts erneut", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-15"));

			const host = makeHost(root);
			const now = new Date("2026-06-16T03:00:00.000Z");
			const first = await runDailyEvaluatorBatch(host, { now });
			assert.deepEqual(first.processedDateKeys, ["2026-06-15"]);

			const second = await runDailyEvaluatorBatch(host, { now });
			assert.deepEqual(second.processedDateKeys, []);
			assert.deepEqual(second.skippedAlreadyEvaluated, ["2026-06-15"]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("unvollständiger Tag (day.complete=false) wird übersprungen statt bewertet", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			const incompleteDay = freshDay("2026-06-15");
			incompleteDay.complete = false;
			await writeDayTelemetryDay(telemetryDir, incompleteDay);

			const host = makeHost(root);
			const result = await runDailyEvaluatorBatch(host, { now: new Date("2026-06-16T03:00:00.000Z") });
			assert.deepEqual(result.processedDateKeys, []);
			assert.deepEqual(result.skippedIncomplete, ["2026-06-15"]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("heutiger/zukünftiger Tag wird nie als complete verarbeitet, auch wenn day.complete=true gesetzt ist", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-16"));

			const host = makeHost(root);
			const result = await runDailyEvaluatorBatch(host, { now: new Date("2026-06-16T10:00:00.000Z") });
			assert.deepEqual(result.processedDateKeys, []);
			assert.deepEqual(result.skippedIncomplete, []);
			assert.deepEqual(result.errors, []);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("fehlende Telemetrie-Tagesdatei (gelistet, aber nicht lesbar) landet in errors statt Abbruch des ganzen Batches", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			await fs.writeFile(path.join(telemetryDir, "2026-06-14.json"), "not valid json {{{");
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-15"));

			const host = makeHost(root);
			const result = await runDailyEvaluatorBatch(host, { now: new Date("2026-06-16T03:00:00.000Z") });
			assert.deepEqual(result.processedDateKeys, ["2026-06-15"]);
			assert.equal(result.errors.length, 1);
			assert.equal(result.errors[0].dateKey, "2026-06-14");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("learning_state_v1.json wird über den Batch hinweg fortgeschrieben (lastProcessedDateKey = letzter verarbeiteter Tag)", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-14"));
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-15"));

			const host = makeHost(root);
			await runDailyEvaluatorBatch(host, { now: new Date("2026-06-16T03:00:00.000Z") });

			const stateDir = path.join(root, DAILY_EVALUATOR_STATE_CATEGORY);
			const raw = await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8");
			const state = JSON.parse(raw);
			assert.equal(state.lastProcessedDateKey, "2026-06-15");
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("Retention: Zurückliegen älter als DAY_TELEMETRY_RETENTION_DAYS wird nicht mehr aufgeholt", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			const now = new Date("2026-06-16T03:00:00.000Z");
			const tooOld = addDaysToDateKey("2026-06-16", -100);
			await writeDayTelemetryDay(telemetryDir, await completeDay(tooOld));
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-15"));

			const host = makeHost(root);
			const result = await runDailyEvaluatorBatch(host, { now });
			assert.deepEqual(result.processedDateKeys, ["2026-06-15"]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("force=true erlaubt Re-Evaluation, überschreibt findings/scores, lässt Learning-State standardmäßig unverändert für den Re-Run", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
		try {
			const telemetryDir = path.join(root, DAY_TELEMETRY_CATEGORY);
			await fs.mkdir(telemetryDir, { recursive: true });
			await writeDayTelemetryDay(telemetryDir, await completeDay("2026-06-15"));

			const host = makeHost(root);
			const now = new Date("2026-06-16T03:00:00.000Z");
			await runDailyEvaluatorBatch(host, { now });

			const stateDir = path.join(root, DAILY_EVALUATOR_STATE_CATEGORY);
			const before = JSON.parse(await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8"));

			const forced = await runDailyEvaluatorBatch(host, { now, force: true });
			assert.deepEqual(forced.processedDateKeys, ["2026-06-15"]);

			const after = JSON.parse(await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8"));
			assert.deepEqual(after, before);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});

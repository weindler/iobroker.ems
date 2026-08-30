import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadBlockALearningSnapshot } from "./block_a_learning_bridge.js";
import { writeDailyEvaluatorLearningState, learningStatePath } from "../../learning/daily_evaluator/persist.js";
import { emptyDailyEvaluatorLearningState, emptyLearningMetric } from "../../learning/daily_evaluator/types.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "block-a-bridge-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("Block B - Block-A-Learning-Bridge (read-only)", () => {
	it("Host ohne getAbsolutePath -> leerer Snapshot, kein Crash", async () => {
		const snapshot = await loadBlockALearningSnapshot({});
		assert.equal(snapshot.thermalPriceTimingScore.value, null);
		assert.equal(snapshot.batteryReserveAccuracyPct.value, null);
		assert.equal(snapshot.updatedAtIso, null);
	});

	it("fehlende learning_state_v1.json -> leerer Snapshot, kein Crash", async () => {
		await withTempDir(async (dir) => {
			const snapshot = await loadBlockALearningSnapshot({ getAbsolutePath: () => dir });
			assert.equal(snapshot.thermalPriceTimingScore.value, null);
			assert.equal(snapshot.batteryReserveAccuracyPct.value, null);
		});
	});

	it("beschaedigte learning_state_v1.json -> leerer Snapshot (Fallback), kein Crash", async () => {
		await withTempDir(async (dir) => {
			await fs.writeFile(learningStatePath(dir), "{not valid json");
			const snapshot = await loadBlockALearningSnapshot({ getAbsolutePath: () => dir });
			assert.equal(snapshot.thermalPriceTimingScore.value, null);
			assert.equal(snapshot.batteryReserveAccuracyPct.value, null);
		});
	});

	it("gueltiger Block-A-State -> thermalPriceTimingScore + batteryReserveAccuracyPct 1:1 uebernommen", async () => {
		await withTempDir(async (dir) => {
			const state = emptyDailyEvaluatorLearningState();
			state.thermalPriceTimingScore = {
				...emptyLearningMetric(),
				value: 72,
				sampleCount: 40,
				confidence: 85,
				updatedAtIso: "2026-06-15T23:00:00.000Z",
			};
			state.batteryReserveAccuracyPct = {
				...emptyLearningMetric(),
				value: 33,
				sampleCount: 20,
				confidence: 60,
				updatedAtIso: "2026-06-15T23:00:00.000Z",
			};
			await writeDailyEvaluatorLearningState(dir, state);

			const snapshot = await loadBlockALearningSnapshot({ getAbsolutePath: () => dir });
			assert.deepEqual(snapshot.thermalPriceTimingScore, {
				value: 72,
				sampleCount: 40,
				confidencePct: 85,
			});
			assert.deepEqual(snapshot.batteryReserveAccuracyPct, {
				value: 33,
				sampleCount: 20,
				confidencePct: 60,
			});
			assert.equal(snapshot.updatedAtIso, state.updatedAtIso);
		});
	});

	it("Bridge schreibt niemals in den Block-A-State (rein lesend)", async () => {
		await withTempDir(async (dir) => {
			await loadBlockALearningSnapshot({ getAbsolutePath: () => dir });
			await assert.rejects(fs.access(learningStatePath(dir)));
		});
	});
});

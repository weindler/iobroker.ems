import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyLearningMetric } from "./types.js";
import { updateLearningMetric, confidenceFromSampleCount, LEARNING_MIN_SAMPLES_FOR_CONFIDENCE } from "./learning_math.js";

describe("daily_evaluator learning_math", () => {
	it("confidenceFromSampleCount: unter Mindestanzahl → null", () => {
		assert.equal(confidenceFromSampleCount(LEARNING_MIN_SAMPLES_FOR_CONFIDENCE - 1, 20), null);
	});

	it("confidenceFromSampleCount: skaliert bis targetSamples, dann gekappt auf 100", () => {
		assert.equal(confidenceFromSampleCount(10, 20), 50);
		assert.equal(confidenceFromSampleCount(20, 20), 100);
		assert.equal(confidenceFromSampleCount(40, 20), 100);
	});

	it("updateLearningMetric: erstes Sample setzt Mittelwert direkt", () => {
		const m = updateLearningMetric(emptyLearningMetric(), 42, "2026-06-15T10:00:00.000Z", 20);
		assert.equal(m.value, 42);
		assert.equal(m.sampleCount, 1);
		assert.equal(m.min, 42);
		assert.equal(m.max, 42);
		assert.equal(m.variance, 0);
	});

	it("updateLearningMetric: Online-Mittelwert über mehrere Samples entspricht dem einfachen Mittel", () => {
		let m = emptyLearningMetric();
		const values = [10, 20, 30, 40];
		for (const v of values) m = updateLearningMetric(m, v, "2026-06-15T10:00:00.000Z", 20);
		assert.equal(m.value, 25);
		assert.equal(m.sampleCount, 4);
		assert.equal(m.min, 10);
		assert.equal(m.max, 40);
	});

	it("updateLearningMetric: Varianz für konstante Werte ist 0", () => {
		let m = emptyLearningMetric();
		for (let i = 0; i < 5; i++) m = updateLearningMetric(m, 100, "2026-06-15T10:00:00.000Z", 20);
		assert.equal(m.value, 100);
		assert.equal(m.variance, 0);
	});

	it("updateLearningMetric: NaN/Infinity wird ignoriert (kein Sample-Zuwachs)", () => {
		const before = updateLearningMetric(emptyLearningMetric(), 5, "2026-06-15T10:00:00.000Z", 20);
		const after = updateLearningMetric(before, Number.NaN, "2026-06-15T11:00:00.000Z", 20);
		assert.deepEqual(after, before);
	});

	it("updateLearningMetric: periodStartIso bleibt beim ersten Wert, periodEndIso wird fortgeschrieben", () => {
		let m = updateLearningMetric(emptyLearningMetric(), 1, "2026-06-15T10:00:00.000Z", 20);
		m = updateLearningMetric(m, 2, "2026-06-16T10:00:00.000Z", 20);
		assert.equal(m.periodStartIso, "2026-06-15T10:00:00.000Z");
		assert.equal(m.periodEndIso, "2026-06-16T10:00:00.000Z");
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampToBounds, evaluateLearningGate } from "./learning_gate.js";

describe("Block B — learning gate", () => {
	const cfg = { minSampleCount: 5, minConfidencePct: 60 };

	it("Confidence unbekannt → nicht nutzbar (learning_gate_signal_unknown)", () => {
		const r = evaluateLearningGate({ sampleCount: 10, confidencePct: null }, cfg);
		assert.equal(r.usable, false);
		assert.equal(!r.usable && r.reasonCode, "learning_gate_signal_unknown");
	});

	it("Sample-Count zu niedrig → nicht nutzbar (learning_gate_sample_count_low)", () => {
		const r = evaluateLearningGate({ sampleCount: 2, confidencePct: 90 }, cfg);
		assert.equal(r.usable, false);
		assert.equal(!r.usable && r.reasonCode, "learning_gate_sample_count_low");
	});

	it("Confidence zu niedrig → nicht nutzbar (learning_gate_confidence_low)", () => {
		const r = evaluateLearningGate({ sampleCount: 10, confidencePct: 40 }, cfg);
		assert.equal(r.usable, false);
		assert.equal(!r.usable && r.reasonCode, "learning_gate_confidence_low");
	});

	it("sampleCount null gilt als nicht anwendbar, nicht als Ablehnung", () => {
		const r = evaluateLearningGate({ sampleCount: null, confidencePct: 90 }, cfg);
		assert.equal(r.usable, true);
	});

	it("beide Schwellen erfüllt → nutzbar", () => {
		const r = evaluateLearningGate({ sampleCount: 10, confidencePct: 90 }, cfg);
		assert.equal(r.usable, true);
	});

	it("clampToBounds hält Werte in Grenzen, NaN → min", () => {
		assert.equal(clampToBounds(5, 0, 10), 5);
		assert.equal(clampToBounds(-5, 0, 10), 0);
		assert.equal(clampToBounds(50, 0, 10), 10);
		assert.equal(clampToBounds(Number.NaN, 2, 10), 2);
	});
});

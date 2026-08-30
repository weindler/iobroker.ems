import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	calibrateBatteryOpportunityMargin,
	toBatteryReserveLearningExplanation,
	BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH,
	BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT,
	BATTERY_LEARNING_MIN_SAMPLE_COUNT,
	BATTERY_LEARNING_MIN_CONFIDENCE_PCT,
} from "./battery_reserve_learning.js";

describe("Block B — Battery Learned Opportunity (batteryReserveAccuracyPct)", () => {
	it("Metrik fehlt (null) -> nicht usable, extraMarginCtPerKwh=0 (exakt bisheriges Verhalten)", () => {
		const r = calibrateBatteryOpportunityMargin(null);
		assert.equal(r.usable, false);
		assert.equal(r.gateReason, "battery_learning_metric_missing");
		assert.equal(r.extraMarginCtPerKwh, 0);
	});

	it("zu wenig Samples -> nicht usable, extraMarginCtPerKwh=0", () => {
		const r = calibrateBatteryOpportunityMargin({
			value: 40,
			sampleCount: BATTERY_LEARNING_MIN_SAMPLE_COUNT - 1,
			confidencePct: 90,
		});
		assert.equal(r.usable, false);
		assert.equal(r.gateReason, "learning_gate_sample_count_low");
		assert.equal(r.extraMarginCtPerKwh, 0);
	});

	it("Confidence zu niedrig -> nicht usable, extraMarginCtPerKwh=0", () => {
		const r = calibrateBatteryOpportunityMargin({
			value: 40,
			sampleCount: 50,
			confidencePct: BATTERY_LEARNING_MIN_CONFIDENCE_PCT - 1,
		});
		assert.equal(r.usable, false);
		assert.equal(r.gateReason, "learning_gate_confidence_low");
		assert.equal(r.extraMarginCtPerKwh, 0);
	});

	it("ungueltiger Wert (ausserhalb 0..100) -> nicht usable, extraMarginCtPerKwh=0", () => {
		const r = calibrateBatteryOpportunityMargin({ value: 140, sampleCount: 50, confidencePct: 90 });
		assert.equal(r.usable, false);
		assert.equal(r.gateReason, "battery_learning_value_invalid");
		assert.equal(r.extraMarginCtPerKwh, 0);
	});

	it("Reserve historisch voll zuverlaessig (>= FULL_TRUST) -> keine Zusatzmarge", () => {
		const r = calibrateBatteryOpportunityMargin({
			value: BATTERY_LEARNING_FULL_TRUST_ACCURACY_PCT,
			sampleCount: 50,
			confidencePct: 90,
		});
		assert.equal(r.usable, true);
		assert.equal(r.extraMarginCtPerKwh, 0);
	});

	it("Reserve historisch unzuverlaessig (0 %) -> maximale Zusatzmarge, nie mehr", () => {
		const r = calibrateBatteryOpportunityMargin({ value: 0, sampleCount: 50, confidencePct: 90 });
		assert.equal(r.usable, true);
		assert.equal(r.extraMarginCtPerKwh, BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH);
	});

	it("mittlerer Trefferanteil -> Zusatzmarge liegt strikt zwischen 0 und Max", () => {
		const r = calibrateBatteryOpportunityMargin({ value: 45, sampleCount: 50, confidencePct: 90 });
		assert.equal(r.usable, true);
		assert.ok(r.extraMarginCtPerKwh > 0);
		assert.ok(r.extraMarginCtPerKwh < BATTERY_LEARNING_EXTRA_MARGIN_MAX_CT_PER_KWH);
	});

	it("Zusatzmarge ist niemals negativ, auch bei Wert > FULL_TRUST", () => {
		const r = calibrateBatteryOpportunityMargin({ value: 99, sampleCount: 50, confidencePct: 90 });
		assert.equal(r.usable, true);
		assert.ok(r.extraMarginCtPerKwh >= 0);
	});

	describe("toBatteryReserveLearningExplanation", () => {
		it("nicht usable -> changedByLearning immer false, unabhaengig von Baseline/Adjusted-Diff", () => {
			const calibration = calibrateBatteryOpportunityMargin(null);
			const explanation = toBatteryReserveLearningExplanation(calibration, true, false);
			assert.equal(explanation.changedByLearning, false);
			assert.equal(explanation.baselineDecision, true);
			assert.equal(explanation.adjustedDecision, false);
			assert.deepEqual(explanation.reasonCodes, []);
		});

		it("usable + Entscheidung tatsaechlich veraendert -> changedByLearning=true", () => {
			const calibration = calibrateBatteryOpportunityMargin({ value: 0, sampleCount: 50, confidencePct: 90 });
			const explanation = toBatteryReserveLearningExplanation(calibration, true, false);
			assert.equal(explanation.changedByLearning, true);
			assert.deepEqual(explanation.reasonCodes, ["battery_reserve_learning_margin_increased"]);
			assert.equal(explanation.learningMetrics.length, 1);
			assert.equal(explanation.learningMetrics[0]!.name, "batteryReserveAccuracyPct");
		});

		it("usable, aber Entscheidung unveraendert (Marge reichte fuer keine Aenderung) -> changedByLearning=false", () => {
			const calibration = calibrateBatteryOpportunityMargin({ value: 20, sampleCount: 50, confidencePct: 90 });
			const explanation = toBatteryReserveLearningExplanation(calibration, true, true);
			assert.equal(explanation.changedByLearning, false);
		});
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	evaluateThermalDeferOpportunity,
	calibrateThermalOpportunityGap,
	toThermalLearningExplanation,
	THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP,
	THERMAL_LEARNING_GAP_MIN,
	THERMAL_LEARNING_GAP_MAX,
	THERMAL_LEARNING_MIN_SAMPLE_COUNT,
	THERMAL_LEARNING_MIN_CONFIDENCE_PCT,
} from "./thermal_opportunity_gate.js";
import type { UnifiedPvSlot } from "./types.js";

function pvSlot(startIso: string, endIso: string, kwh: number): UnifiedPvSlot {
	return {
		slot: { startIso, endIso },
		forecastPowerW: null,
		observedPowerW: null,
		energyKwh: kwh,
	};
}

/** 8 Slots — Kandidat (idx 2) niedrig, weit später (idx 6) deutlich höher. */
function slots(): UnifiedPvSlot[] {
	const base = Date.parse("2026-06-15T08:00:00.000Z");
	const kwhByIdx = [0.1, 0.1, 0.1, 0.1, 2.0, 2.5, 3.0, 0.2];
	return kwhByIdx.map((kwh, i) => {
		const startMs = base + i * 3600_000;
		return pvSlot(new Date(startMs).toISOString(), new Date(startMs + 3600_000).toISOString(), kwh);
	});
}

describe("Block B — thermal opportunity gate", () => {
	it("deutlich besseres PV-Fenster vor Deadline gefunden → defer=true", () => {
		const s = slots();
		const candidateMs = Date.parse(s[2]!.slot.startIso);
		const emptyAtMs = Date.parse(s[7]!.slot.startIso) + 1; // nach Slot 6 (das bessere Fenster)
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: candidateMs,
			thermalEmptyAtMs: emptyAtMs,
			pvSlots: s,
			pvForecastConfidence01: 0.9,
		});
		assert.equal(r.defer, true);
		assert.equal(r.reasonCode, "thermal_significant_better_pv_window_before_empty");
	});

	it("besseres Fenster liegt NACH thermalEmptyAtIso → kein Defer", () => {
		const s = slots();
		const candidateMs = Date.parse(s[2]!.slot.startIso);
		// Deadline knapp vor dem besseren Fenster (Slot 4) — das bessere Fenster ist nicht mehr erreichbar.
		const emptyAtMs = Date.parse(s[4]!.slot.startIso);
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: candidateMs,
			thermalEmptyAtMs: emptyAtMs,
			pvSlots: s,
			pvForecastConfidence01: 0.9,
		});
		assert.equal(r.defer, false);
	});

	it("keine Deadline bekannt (thermalEmptyAtMs=null) → kein Defer (Fallback)", () => {
		const s = slots();
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: Date.parse(s[2]!.slot.startIso),
			thermalEmptyAtMs: null,
			pvSlots: s,
			pvForecastConfidence01: 0.9,
		});
		assert.equal(r.defer, false);
		assert.equal(r.reasonCode, null);
	});

	it("PV-Forecast-Confidence unter Learning-Gate-Schwelle → kein Defer, Reason-Code gesetzt", () => {
		const s = slots();
		const candidateMs = Date.parse(s[2]!.slot.startIso);
		const emptyAtMs = Date.parse(s[7]!.slot.startIso) + 1;
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: candidateMs,
			thermalEmptyAtMs: emptyAtMs,
			pvSlots: s,
			pvForecastConfidence01: 0.2, // 20 % < 50 % Schwelle
		});
		assert.equal(r.defer, false);
		assert.equal(r.reasonCode, "learning_gate_confidence_low");
	});

	it("Confidence unbekannt (null) → kein Defer, learning_gate_signal_unknown", () => {
		const s = slots();
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: Date.parse(s[2]!.slot.startIso),
			thermalEmptyAtMs: Date.parse(s[7]!.slot.startIso) + 1,
			pvSlots: s,
			pvForecastConfidence01: null,
		});
		assert.equal(r.defer, false);
		assert.equal(r.reasonCode, "learning_gate_signal_unknown");
	});

	it("nur knapp bessere Fenster (< Perzentil-Lücke) → kein Defer", () => {
		const base = Date.parse("2026-06-15T08:00:00.000Z");
		// 24 streng monoton steigende, gleichmäßig verteilte Werte → Perzentil-Schrittweite 1/24
		// (≈0.042). Deadline schneidet nach 4 Slots ab (max. Lücke 4/24 ≈ 0.167 < 0.3-Schwelle).
		const s = Array.from({ length: 24 }, (_, i) => {
			const startMs = base + i * 3600_000;
			return pvSlot(new Date(startMs).toISOString(), new Date(startMs + 3600_000).toISOString(), i * 0.1);
		});
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: Date.parse(s[10]!.slot.startIso),
			thermalEmptyAtMs: Date.parse(s[14]!.slot.startIso) + 1,
			pvSlots: s,
			pvForecastConfidence01: 0.9,
		});
		assert.equal(r.defer, false);
	});

	it("Kandidat ist bereits das beste Fenster → kein Defer", () => {
		const s = slots();
		// Slot 6 hat den höchsten kWh-Wert der Serie.
		const r = evaluateThermalDeferOpportunity({
			candidateSlotStartMs: Date.parse(s[6]!.slot.startIso),
			thermalEmptyAtMs: Date.parse(s[7]!.slot.startIso) + 1,
			pvSlots: s,
			pvForecastConfidence01: 0.9,
		});
		assert.equal(r.defer, false);
	});

	it("Konstante bleibt bei 0.3 (muss mit Block-A-Evaluator synchron sein)", () => {
		assert.equal(THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP, 0.3);
	});

	describe("LEARNED PLANNER — calibrateThermalOpportunityGap (Block-A thermalPriceTimingScore)", () => {
		it("Metrik fehlt (null) → nicht usable, effectiveGap === baselineGap (Fallback)", () => {
			const c = calibrateThermalOpportunityGap(null);
			assert.equal(c.usable, false);
			assert.equal(c.gateReason, "thermal_learning_metric_missing");
			assert.equal(c.effectiveGap, THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
			assert.equal(c.baselineGap, THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
		});

		it("zu wenig Samples → nicht usable, effectiveGap unverändert", () => {
			const c = calibrateThermalOpportunityGap({
				value: 90,
				sampleCount: THERMAL_LEARNING_MIN_SAMPLE_COUNT - 1,
				confidencePct: 90,
			});
			assert.equal(c.usable, false);
			assert.equal(c.gateReason, "learning_gate_sample_count_low");
			assert.equal(c.effectiveGap, THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
		});

		it("Confidence zu niedrig → nicht usable, effectiveGap unverändert", () => {
			const c = calibrateThermalOpportunityGap({
				value: 90,
				sampleCount: 50,
				confidencePct: THERMAL_LEARNING_MIN_CONFIDENCE_PCT - 1,
			});
			assert.equal(c.usable, false);
			assert.equal(c.gateReason, "learning_gate_confidence_low");
		});

		it("ungültiger Wert (außerhalb 0..100) → nicht usable", () => {
			const c = calibrateThermalOpportunityGap({ value: 150, sampleCount: 50, confidencePct: 90 });
			assert.equal(c.usable, false);
			assert.equal(c.gateReason, "thermal_learning_value_invalid");
		});

		it("hoher Score (gutes historisches Timing) → Schwelle sinkt, bleibt aber >= GAP_MIN", () => {
			const c = calibrateThermalOpportunityGap({ value: 100, sampleCount: 50, confidencePct: 90 });
			assert.equal(c.usable, true);
			assert.ok(c.effectiveGap < THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
			assert.ok(c.effectiveGap >= THERMAL_LEARNING_GAP_MIN);
		});

		it("niedriger Score (schlechtes historisches Timing) → Schwelle steigt, bleibt aber <= GAP_MAX", () => {
			const c = calibrateThermalOpportunityGap({ value: 0, sampleCount: 50, confidencePct: 90 });
			assert.equal(c.usable, true);
			assert.ok(c.effectiveGap > THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
			assert.ok(c.effectiveGap <= THERMAL_LEARNING_GAP_MAX);
		});

		it("Score genau 50 (neutral) → effectiveGap === baselineGap", () => {
			const c = calibrateThermalOpportunityGap({ value: 50, sampleCount: 50, confidencePct: 90 });
			assert.equal(c.usable, true);
			assert.equal(c.effectiveGap, THERMAL_OPPORTUNITY_PV_PERCENTILE_GAP);
		});
	});

	describe("LEARNED PLANNER — evaluateThermalDeferOpportunity mit learnedPriceTimingScore", () => {
		it("niedriger Score senkt effektiv die Schwelle nicht unter das Ergebnis ohne Learning: nur knapp bessere Fenster (< 0.3, aber >= niedrigerer effektiver Gap durch hohen Score) → changedByLearning=true", () => {
			// 24 gleichmäßig verteilte Werte → Perzentil-Schrittweite 1/24 (~0.0417).
			// Lücke von genau 5 Slots ≈ 5/24 ≈ 0.208 — < 0.3 (baseline), aber >= 0.2 (GAP_MIN bei Score=100).
			const base = Date.parse("2026-06-15T08:00:00.000Z");
			const s = Array.from({ length: 24 }, (_, i) => {
				const startMs = base + i * 3600_000;
				return {
					slot: { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + 3600_000).toISOString() },
					forecastPowerW: null,
					observedPowerW: null,
					energyKwh: i * 0.1,
				} satisfies UnifiedPvSlot;
			});
			const candidateMs = Date.parse(s[5]!.slot.startIso);
			const emptyAtMs = Date.parse(s[10]!.slot.startIso) + 1;

			const withoutLearning = evaluateThermalDeferOpportunity({
				candidateSlotStartMs: candidateMs,
				thermalEmptyAtMs: emptyAtMs,
				pvSlots: s,
				pvForecastConfidence01: 0.9,
			});
			assert.equal(withoutLearning.baselineDefer, false);
			assert.equal(withoutLearning.changedByLearning, false);

			const withLearning = evaluateThermalDeferOpportunity({
				candidateSlotStartMs: candidateMs,
				thermalEmptyAtMs: emptyAtMs,
				pvSlots: s,
				pvForecastConfidence01: 0.9,
				learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: 90 },
			});
			assert.equal(withLearning.baselineDefer, false);
			assert.equal(withLearning.adjustedDefer, true);
			assert.equal(withLearning.defer, true);
			assert.equal(withLearning.changedByLearning, true);
			assert.equal(withLearning.learning.usable, true);
		});

		it("Learning-Metrik nicht usable (fehlende Confidence) → adjustedDefer === baselineDefer, changedByLearning=false", () => {
			const s = slots();
			const candidateMs = Date.parse(s[2]!.slot.startIso);
			const emptyAtMs = Date.parse(s[7]!.slot.startIso) + 1;
			const r = evaluateThermalDeferOpportunity({
				candidateSlotStartMs: candidateMs,
				thermalEmptyAtMs: emptyAtMs,
				pvSlots: s,
				pvForecastConfidence01: 0.9,
				learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: null },
			});
			assert.equal(r.baselineDefer, r.adjustedDefer);
			assert.equal(r.changedByLearning, false);
			assert.equal(r.learning.usable, false);
		});

		it("toThermalLearningExplanation: null-Result → null", () => {
			assert.equal(toThermalLearningExplanation(null), null);
			assert.equal(toThermalLearningExplanation(undefined), null);
		});

		it("toThermalLearningExplanation: usable + verändert → changedByLearning=true, Metrik enthalten", () => {
			const s = slots();
			const emptyAtMs = Date.parse(s[7]!.slot.startIso) + 1;
			const r = evaluateThermalDeferOpportunity({
				candidateSlotStartMs: Date.parse(s[2]!.slot.startIso),
				thermalEmptyAtMs: emptyAtMs,
				pvSlots: s,
				pvForecastConfidence01: 0.9,
				learnedPriceTimingScore: { value: 100, sampleCount: 50, confidencePct: 90 },
			});
			const explanation = toThermalLearningExplanation(r);
			assert.ok(explanation);
			assert.equal(explanation!.baselineDecision, r.baselineDefer);
			assert.equal(explanation!.adjustedDecision, r.adjustedDefer);
			assert.equal(explanation!.learningMetrics[0]!.name, "thermalPriceTimingScore");
		});
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFinding } from "./test_helpers.js";
import { applyDayToLearningState } from "./learning.js";
import { emptyDailyEvaluatorLearningState, type EvaluationRecord } from "./types.js";

function baseRecord(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
	return {
		evaluatorSchemaVersion: 1,
		sourceTelemetrySchemaVersion: 1,
		sourceUpdatedAtIso: "2026-06-15T23:00:00.000Z",
		dateKey: "2026-06-15",
		timezone: "Europe/Berlin",
		evaluatedAtIso: "2026-06-16T03:00:00.000Z",
		dayComplete: true,
		dayEvaluable: true,
		dayCoveragePct: 100,
		eligibility: [],
		findingsCount: 0,
		findingsByDomain: { battery: 0, thermal: 0, climate: 0, ev: 0 },
		scores: [],
		globalScore: null,
		globalScoreWeights: {},
		...overrides,
	};
}

describe("daily_evaluator learning (diagnostisch, eigener State)", () => {
	it("battery reserve_held Finding aktualisiert nur batteryReserveAccuracyPct", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
		];
		const next = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(next.batteryReserveAccuracyPct.value, 100);
		assert.equal(next.batteryReserveAccuracyPct.sampleCount, 1);
		assert.equal(next.thermalPriceTimingScore.sampleCount, 0);
		assert.equal(next.climatePriceTimingScore.sampleCount, 0);
		assert.equal(next.evReadinessMetRatePct.sampleCount, 0);
	});

	it("insufficientData/notApplicable Findings fließen NICHT ins Learning ein", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"], insufficientData: true }),
			makeFinding({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_met"], notApplicable: true }),
		];
		const next = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(next.batteryReserveAccuracyPct.sampleCount, 0);
		assert.equal(next.evReadinessMetRatePct.sampleCount, 0);
	});

	it("thermal daily_plan_price_timed Finding aktualisiert thermalPriceTimingScore aus outcomeQuality", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({
				domain: "thermal",
				reasonCodes: ["daily_plan_price_timed"],
				quality: { decisionQuality: "reasonable", outcomeQuality: "wasteful" },
			}),
		];
		const next = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(next.thermalPriceTimingScore.value, 0);
		assert.equal(next.thermalPriceTimingScore.sampleCount, 1);
	});

	it("climate price_timed Finding aktualisiert climatePriceTimingScore aus outcomeQuality", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({
				domain: "climate",
				reasonCodes: ["price_timed"],
				quality: { decisionQuality: "reasonable", outcomeQuality: "reasonable" },
			}),
		];
		const next = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(next.climatePriceTimingScore.value, 100);
		assert.equal(next.climatePriceTimingScore.sampleCount, 1);
	});

	it("ev readiness Finding aktualisiert evReadinessMetRatePct", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_missed"] }),
		];
		const next = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(next.evReadinessMetRatePct.value, 0);
		assert.equal(next.evReadinessMetRatePct.sampleCount, 1);
	});

	it("pv/price Scores aus EvaluationRecord.scores fließen ein, wenn value != null", () => {
		const state = emptyDailyEvaluatorLearningState();
		const record = baseRecord({
			scores: [
				{ topic: "pv", value: 80, sampleCount: 1, basis: "self_consumed_share_of_pv" },
				{ topic: "price", value: 60, sampleCount: 1, basis: "consumption_weighted_price_percentile" },
			],
		});
		const next = applyDayToLearningState(state, record, []);
		assert.equal(next.pvUtilizationPct.value, 80);
		assert.equal(next.priceEfficiencyScore.value, 60);
	});

	it("domain-basiert: global insufficient Tag (dayEvaluable=false) liefert trotzdem Battery-Sample, wenn dieses konklusiv ist (Korrektur #6)", () => {
		const state = emptyDailyEvaluatorLearningState();
		const record = baseRecord({ dayEvaluable: false, dayCoveragePct: 40 });
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
		];
		const next = applyDayToLearningState(state, record, findings);
		assert.equal(next.batteryReserveAccuracyPct.sampleCount, 1);
	});

	it("Idempotenz: derselbe (oder ein älterer) dateKey wird nicht doppelt eingerechnet", () => {
		const state = emptyDailyEvaluatorLearningState();
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
		];
		const once = applyDayToLearningState(state, baseRecord(), findings);
		assert.equal(once.lastProcessedDateKey, "2026-06-15");

		const again = applyDayToLearningState(once, baseRecord(), findings);
		assert.equal(again.batteryReserveAccuracyPct.sampleCount, 1);
		assert.deepEqual(again, once);

		const older = applyDayToLearningState(once, baseRecord({ dateKey: "2026-06-14" }), findings);
		assert.equal(older.batteryReserveAccuracyPct.sampleCount, 1);
		assert.deepEqual(older, once);
	});

	it("lastProcessedDateKey und updatedAtIso werden nach Verarbeitung fortgeschrieben", () => {
		const state = emptyDailyEvaluatorLearningState();
		const next = applyDayToLearningState(state, baseRecord(), [], "2026-06-16T04:00:00.000Z");
		assert.equal(next.lastProcessedDateKey, "2026-06-15");
		assert.equal(next.updatedAtIso, "2026-06-16T04:00:00.000Z");
	});
});

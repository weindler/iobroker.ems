import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshDay, makeFinding } from "./test_helpers.js";
import { computeDomainScores, computeGlobalScore } from "./scores.js";
import { SCORE_TOPIC } from "./types.js";

describe("daily_evaluator scores", () => {
	it("batteryScore: reserve_held_ratio aus konklusiven Reserve-Checks", () => {
		const day = freshDay();
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_undercut"] }),
		];
		const scores = computeDomainScores(day, findings);
		const battery = scores.find((s) => s.topic === SCORE_TOPIC.BATTERY)!;
		assert.equal(battery.value, 66.7);
		assert.equal(battery.sampleCount, 3);
	});

	it("batteryScore: keine konklusiven Checks → value null, keine erfundene Zahl", () => {
		const day = freshDay();
		const findings = [
			makeFinding({ domain: "battery", eventType: "battery_reserve_check", insufficientData: true, reasonCodes: ["reserve_check_window_undercovered"] }),
		];
		const scores = computeDomainScores(day, findings);
		const battery = scores.find((s) => s.topic === SCORE_TOPIC.BATTERY)!;
		assert.equal(battery.value, null);
		assert.equal(battery.sampleCount, 0);
	});

	it("thermalScore: Mittel aus outcomeQuality-Klassifikation nutzbarer Findings", () => {
		const day = freshDay();
		const findings = [
			makeFinding({ domain: "thermal", quality: { decisionQuality: "reasonable", outcomeQuality: "reasonable" } }),
			makeFinding({ domain: "thermal", quality: { decisionQuality: "wasteful", outcomeQuality: "wasteful" } }),
			makeFinding({ domain: "thermal", quality: { decisionQuality: "unknown", outcomeQuality: "unknown" }, insufficientData: true }),
		];
		const scores = computeDomainScores(day, findings);
		const thermal = scores.find((s) => s.topic === SCORE_TOPIC.THERMAL)!;
		assert.equal(thermal.value, 50);
		assert.equal(thermal.sampleCount, 2);
	});

	it("evScore: readiness_met_ratio aus konklusiven Readiness-Checks", () => {
		const day = freshDay();
		const findings = [
			makeFinding({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_met"] }),
			makeFinding({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_missed"] }),
		];
		const scores = computeDomainScores(day, findings);
		const ev = scores.find((s) => s.topic === SCORE_TOPIC.EV)!;
		assert.equal(ev.value, 50);
		assert.equal(ev.sampleCount, 2);
	});

	it("pvUtilizationScore: rein deskriptiv aus PV-/Export-Buckets, keine PV-Produktion → null", () => {
		const day = freshDay();
		const scores = computeDomainScores(day, []);
		const pv = scores.find((s) => s.topic === SCORE_TOPIC.PV)!;
		assert.equal(pv.value, null);
	});

	it("pvUtilizationScore: Eigenverbrauchsanteil aus pvKwh/gridExportKwh", () => {
		const day = freshDay();
		day.buckets.pvKwh[0] = 10;
		day.buckets.gridExportKwh[0] = 4;
		const scores = computeDomainScores(day, []);
		const pv = scores.find((s) => s.topic === SCORE_TOPIC.PV)!;
		assert.equal(pv.value, 60);
	});

	it("comfortScore ist immer null (keine Komfort-Telemetrie) — keine Scheingenauigkeit", () => {
		const day = freshDay();
		const scores = computeDomainScores(day, []);
		const comfort = scores.find((s) => s.topic === SCORE_TOPIC.COMFORT)!;
		assert.equal(comfort.value, null);
	});

	it("computeGlobalScore: nur usable Topics fließen ein, Gewichte summieren zu 1", () => {
		const scores = [
			{ topic: SCORE_TOPIC.BATTERY, value: 100, sampleCount: 1, basis: "x" },
			{ topic: SCORE_TOPIC.THERMAL, value: 0, sampleCount: 1, basis: "x" },
			{ topic: SCORE_TOPIC.EV, value: null, sampleCount: 0, basis: "x" },
			{ topic: SCORE_TOPIC.COMFORT, value: null, sampleCount: 0, basis: "x" },
		];
		const { globalScore, weights } = computeGlobalScore(scores);
		assert.equal(globalScore, 50);
		assert.equal(Object.keys(weights).length, 2);
		const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
		assert.ok(Math.abs(weightSum - 1) < 1e-9);
	});

	it("computeGlobalScore: keine usable Topics → null statt erfundener Zahl", () => {
		const scores = [{ topic: SCORE_TOPIC.BATTERY, value: null, sampleCount: 0, basis: "x" }];
		const { globalScore, weights } = computeGlobalScore(scores);
		assert.equal(globalScore, null);
		assert.deepEqual(weights, {});
	});
});

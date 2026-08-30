import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateDay } from "./evaluate.js";
import { DOMAIN_QUALITY, encodeQualityMask } from "../day_telemetry/quality_mask.js";

describe("daily_evaluator evaluate (Orchestrator)", () => {
	it("leerer Tag ohne jede Evidenz → alle 4 Domänen not_applicable, keine erfundenen Scores", () => {
		const day = freshDay();
		const { record, findings } = evaluateDay({
			day,
			nextDay: null,
			sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
			sourceTelemetrySchemaVersion: 2,
			evaluatedAtIso: "2026-06-16T03:00:00.000Z",
		});

		assert.equal(record.evaluatorSchemaVersion, 1);
		assert.equal(record.sourceTelemetrySchemaVersion, 2);
		assert.equal(record.sourceUpdatedAtIso, "2026-06-15T22:00:00.000Z");
		assert.equal(record.dateKey, "2026-06-15");
		assert.equal(record.eligibility.length, 4);
		assert.ok(record.eligibility.every((e) => e.status === "not_applicable"));
		assert.equal(findings.length, 4);
		assert.ok(findings.every((f) => f.notApplicable === true));
		assert.equal(record.findingsCount, 4);
		assert.equal(record.globalScore, null);
		assert.deepEqual(record.globalScoreWeights, {});
	});

	it("Battery evaluable + reserve_held → genau ein Battery-Finding, andere Domänen bleiben not_applicable", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T18:00:00.000Z",
				batterySocPct: 40,
				batteryDecision: {
					action: "discharge_allowed",
					dischargeAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
					reasonCode: "price_and_reserve_ok",
				},
			}),
		);
		for (let ms = Date.parse("2026-06-15T18:00:00.000Z"); ms < Date.parse("2026-06-15T22:00:00.000Z"); ms += 15 * 60_000) {
			const idx = Math.floor((ms - day.startMs) / (15 * 60_000));
			day.buckets.batterySocEndPct[idx] = 40;
		}
		const batteryOkMask = encodeQualityMask({ BATTERY: DOMAIN_QUALITY.ok });
		for (let i = 0; i < day.buckets.qualityMask.length; i++) day.buckets.qualityMask[i] = batteryOkMask;

		const { record, findings } = evaluateDay({
			day,
			nextDay: null,
			sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
			sourceTelemetrySchemaVersion: 2,
		});

		const batteryElig = record.eligibility.find((e) => e.domain === "battery")!;
		assert.equal(batteryElig.status, "evaluable");

		const batteryFindings = findings.filter((f) => f.domain === "battery");
		assert.equal(batteryFindings.length, 1);
		assert.ok(batteryFindings[0].reasonCodes.includes("reserve_held"));
		assert.equal(record.findingsByDomain.battery, 1);

		const otherDomainFindings = findings.filter((f) => f.domain !== "battery");
		assert.ok(otherDomainFindings.every((f) => f.notApplicable === true));

		const batteryScore = record.scores.find((s) => s.topic === "battery")!;
		assert.equal(batteryScore.value, 100);
		assert.equal(record.globalScore, 100);
		assert.equal(Object.keys(record.globalScoreWeights).length, 1);
	});

	it("reine Funktion: gleicher Input → identisches Ergebnis (Idempotenz auf Record-Ebene)", () => {
		const day = freshDay();
		const input = {
			day,
			nextDay: null,
			sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
			sourceTelemetrySchemaVersion: 2,
			evaluatedAtIso: "2026-06-16T03:00:00.000Z",
		};
		const first = evaluateDay(input);
		const second = evaluateDay(input);
		assert.deepEqual(first.record, second.record);
		assert.deepEqual(first.findings, second.findings);
	});

	it("dayComplete/dayEvaluable/dayCoveragePct werden 1:1 aus day_telemetry gespiegelt (kein Learning-Ausschluss hier)", () => {
		const day = freshDay();
		day.complete = false;
		day.evaluable = false;
		day.coveragePct = 12.3;
		const { record } = evaluateDay({
			day,
			nextDay: null,
			sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
			sourceTelemetrySchemaVersion: 2,
		});
		assert.equal(record.dayComplete, false);
		assert.equal(record.dayEvaluable, false);
		assert.equal(record.dayCoveragePct, 12.3);
	});
});

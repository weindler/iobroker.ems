import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout, slotIndexForMs } from "../day_telemetry/slots.js";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateEvFindings } from "./ev_findings.js";

function setEvSoc(day: ReturnType<typeof freshDay>, iso: string, pct: number): void {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	const idx = slotIndexForMs(layout, Date.parse(iso));
	if (idx != null) day.buckets.evSocEndPct[idx] = pct;
}

describe("daily_evaluator ev findings", () => {
	it("Ziel erreicht → ev_readiness_met, outcomeQuality reasonable", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T10:00:00.000Z",
				wallboxTargetSocPct: 80,
				wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
			}),
		);
		setEvSoc(day, "2026-06-15T17:45:00.000Z", 85);
		const findings = evaluateEvFindings(day);
		assert.equal(findings.length, 1);
		assert.ok(findings[0].reasonCodes.includes("ev_readiness_met"));
		assert.equal(findings[0].quality.outcomeQuality, "reasonable");
	});

	it("Ziel verfehlt → ev_readiness_missed, outcomeQuality avoidable", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T10:00:00.000Z",
				wallboxTargetSocPct: 80,
				wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
			}),
		);
		setEvSoc(day, "2026-06-15T17:45:00.000Z", 60);
		const findings = evaluateEvFindings(day);
		assert.ok(findings[0].reasonCodes.includes("ev_readiness_missed"));
		assert.equal(findings[0].quality.outcomeQuality, "avoidable");
	});

	it("kein Ist-SOC zur Deadline messbar → insufficientData statt Behauptung", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T10:00:00.000Z",
				wallboxTargetSocPct: 80,
				wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
			}),
		);
		const findings = evaluateEvFindings(day);
		assert.equal(findings[0].insufficientData, true);
		assert.equal(findings[0].quality.outcomeQuality, "unknown");
	});

	it("mehrere Snapshots mit gleicher Deadline: nur der zuletzt bekannte Zielwert zählt (dedupe)", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({ id: "s1", tsIso: "2026-06-15T08:00:00.000Z", wallboxTargetSocPct: 60, wallboxDeadlineIso: "2026-06-15T18:00:00.000Z" }),
			makeSnapshot({ id: "s2", tsIso: "2026-06-15T14:00:00.000Z", wallboxTargetSocPct: 90, wallboxDeadlineIso: "2026-06-15T18:00:00.000Z" }),
		);
		setEvSoc(day, "2026-06-15T17:45:00.000Z", 70);
		const findings = evaluateEvFindings(day);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].measurements.targetSocPct, 90);
		assert.ok(findings[0].reasonCodes.includes("ev_readiness_missed"));
	});

	it("Ladung ohne bekanntes Ziel → ev_charging_no_target_known, insufficientData", () => {
		const day = freshDay();
		const layout = buildDaySlotLayout(day.dateKey, day.timezone);
		const idx = slotIndexForMs(layout, Date.parse("2026-06-15T10:00:00.000Z"));
		if (idx != null) day.buckets.evChargedKwh[idx] = 5;
		const findings = evaluateEvFindings(day);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].eventType, "ev_charging_no_target_known");
		assert.equal(findings[0].insufficientData, true);
	});

	it("Deadline außerhalb dieses Tages (Cross-Day) → v1 bewusst nicht bewertet", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T22:00:00.000Z",
				wallboxTargetSocPct: 80,
				wallboxDeadlineIso: "2026-06-16T06:00:00.000Z",
			}),
		);
		const findings = evaluateEvFindings(day);
		assert.equal(findings.length, 0);
	});
});

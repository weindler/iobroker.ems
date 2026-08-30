import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout, slotIndexForMs } from "../day_telemetry/slots.js";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateBatteryFindings } from "./battery_findings.js";

const SLOT_MS = 15 * 60_000;

/** Füllt lückenlos alle 15-Minuten-Slots im Fenster [fromIso, toIso) mit pct, damit die
 * Coverage-Schwelle für belastbare Findings erreicht wird (statt nur Stundenmarken). */
function fillSocRange(day: ReturnType<typeof freshDay>, fromIso: string, toIso: string, pct: number): void {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	for (let ms = Date.parse(fromIso); ms < Date.parse(toIso); ms += SLOT_MS) {
		const idx = slotIndexForMs(layout, ms);
		if (idx != null) day.buckets.batterySocEndPct[idx] = pct;
	}
}

describe("daily_evaluator battery findings", () => {
	it("kein Snapshot mit batteryDecision → keine Findings", () => {
		const day = freshDay();
		const findings = evaluateBatteryFindings(day, null);
		assert.equal(findings.length, 0);
	});

	it("Reserve gehalten → reserve_held, outcomeQuality reasonable", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T18:00:00.000Z",
				batteryDecision: {
					action: "hold",
					dischargeAllowed: false,
					requiredSocAtPvEndPct: 30,
					holdActive: true,
					reasonCode: "battery_hold_active",
				},
			}),
		);
		fillSocRange(day, "2026-06-15T18:00:00.000Z", "2026-06-15T22:00:00.000Z", 40);
		const findings = evaluateBatteryFindings(day, null);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].insufficientData, false);
		assert.ok(findings[0].reasonCodes.includes("reserve_held"));
		assert.equal(findings[0].quality.outcomeQuality, "reasonable");
	});

	it("Reserve unterschritten → reserve_undercut, outcomeQuality unknown (keine Ursachen-Attribution)", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T18:00:00.000Z",
				batteryDecision: {
					action: "discharge_allowed",
					dischargeAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
					reasonCode: "price_and_reserve_ok",
				},
			}),
		);
		fillSocRange(day, "2026-06-15T18:00:00.000Z", "2026-06-15T22:00:00.000Z", 25);
		const findings = evaluateBatteryFindings(day, null);
		assert.equal(findings.length, 1);
		assert.ok(findings[0].reasonCodes.includes("reserve_undercut"));
		assert.equal(findings[0].quality.outcomeQuality, "unknown");
		assert.equal(findings[0].quality.decisionQuality, "reasonable");
	});

	it("zu wenig SOC-Daten im Fenster → insufficientData=true, keine Behauptung", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T18:00:00.000Z",
				batteryDecision: {
					action: "discharge_allowed",
					dischargeAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
					reasonCode: "price_and_reserve_ok",
				},
			}),
		);
		const findings = evaluateBatteryFindings(day, null);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].insufficientData, true);
	});

	it("Cross-Midnight: Tiefpunkt im Folgetag wird berücksichtigt, wenn nextDay vorliegt", () => {
		const day = freshDay("2026-06-15");
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T22:00:00.000Z",
				batteryDecision: {
					action: "discharge_allowed",
					dischargeAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
					reasonCode: "price_and_reserve_ok",
				},
			}),
		);

		const nextDay = freshDay("2026-06-16");
		fillSocRange(nextDay, "2026-06-15T22:00:00.000Z", "2026-06-16T08:00:00.000Z", 18); /* Tiefpunkt vor Sonnenaufgang */
		fillSocRange(nextDay, "2026-06-16T08:00:00.000Z", "2026-06-16T16:00:00.000Z", 25);

		const findings = evaluateBatteryFindings(day, nextDay);
		assert.equal(findings.length, 1);
		assert.ok(findings[0].reasonCodes.includes("reserve_undercut"));
		assert.equal(findings[0].measurements.observedMinSocPct, 18);
	});

	it("nextDay fehlt trotz Cross-Midnight-Fenster → insufficientData statt Rekonstruktion", () => {
		const day = freshDay("2026-06-15");
		day.forecastSnapshots.push(
			makeSnapshot({
				tsIso: "2026-06-15T22:00:00.000Z",
				batteryDecision: {
					action: "discharge_allowed",
					dischargeAllowed: true,
					requiredSocAtPvEndPct: 30,
					holdActive: false,
					reasonCode: "price_and_reserve_ok",
				},
			}),
		);
		const findings = evaluateBatteryFindings(day, null);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].insufficientData, true);
	});
});

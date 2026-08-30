import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout } from "../day_telemetry/slots.js";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateThermalFindings } from "./thermal_findings.js";

function priceAtHour(hour: number): number {
	return 10 + hour * 1.5;
}

function cheapExpensivePriceSeries(day: ReturnType<typeof freshDay>): void {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	for (const slot of layout.slots) {
		const hour = new Date(slot.startMs).getUTCHours();
		day.buckets.priceCtPerKwh[slot.index] = priceAtHour(hour);
	}
}

describe("daily_evaluator thermal findings", () => {
	it("Hygiene fällig → mandatory, unabhängig vom Preis", () => {
		const day = freshDay();
		cheapExpensivePriceSeries(day);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
			energyKwh: 1.2,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: "Hygiene fällig — Boiler auf >60 °C bringen.",
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].quality.decisionQuality, "mandatory");
		assert.equal(findings[0].quality.outcomeQuality, "mandatory");
		assert.equal(findings[0].insufficientData, false);
	});

	it("thermal_fallback → necessary", () => {
		const day = freshDay();
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T03:00:00.000Z"),
			endTs: Date.parse("2026-06-15T03:15:00.000Z"),
			energyKwh: 0.5,
			runtimeSec: 900,
			valid: true,
			rejectReason: null,
			decisionSource: "thermal_fallback",
			forcedMode: false,
			hygieneStatusDe: null,
			ownershipOwner: null,
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "necessary");
	});

	it("daily_plan im günstigen Preisfenster → reasonable (decision + outcome)", () => {
		const day = freshDay();
		cheapExpensivePriceSeries(day);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: buildDaySlotLayout(day.dateKey, day.timezone).slots.map((s) => [
				s.startMs,
				priceAtHour(new Date(s.startMs).getUTCHours()),
			] as [number, number]),
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T02:00:00.000Z"),
			endTs: Date.parse("2026-06-15T02:30:00.000Z"),
			energyKwh: 1.0,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: "Hygiene innerhalb 7 Tage erfüllt.",
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "reasonable");
		assert.equal(findings[0].quality.outcomeQuality, "reasonable");
		assert.ok(findings[0].reasonCodes.includes("daily_plan_price_timed"));
	});

	it("daily_plan im teuersten Preisfenster → wasteful", () => {
		const day = freshDay();
		cheapExpensivePriceSeries(day);
		const snap = makeSnapshot({
			tsIso: "2026-06-14T22:00:00.000Z",
			priceSlots: buildDaySlotLayout(day.dateKey, day.timezone).slots.map((s) => [
				s.startMs,
				priceAtHour(new Date(s.startMs).getUTCHours()),
			] as [number, number]),
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-14T23:00:00.000Z"),
			endTs: Date.parse("2026-06-14T23:30:00.000Z"),
			energyKwh: 1.0,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: null,
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "wasteful");
	});

	it("decisionSource unbekannt (ältere/fehlende Daten) → unknown, insufficientData=true", () => {
		const day = freshDay();
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T10:00:00.000Z"),
			endTs: Date.parse("2026-06-15T10:15:00.000Z"),
			energyKwh: 0.3,
			runtimeSec: 900,
			valid: true,
			rejectReason: null,
			decisionSource: null,
			forcedMode: null,
			hygieneStatusDe: null,
			ownershipOwner: null,
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
	});

	it("forcedMode=true wird als reasonCode + userOverride markiert", () => {
		const day = freshDay();
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T10:00:00.000Z"),
			endTs: Date.parse("2026-06-15T10:15:00.000Z"),
			energyKwh: 0.3,
			runtimeSec: 900,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: true,
			hygieneStatusDe: null,
			ownershipOwner: null,
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].userOverride, true);
		assert.ok(findings[0].reasonCodes.includes("forced_mode_active"));
	});

	it("Segment mit 0 Laufzeit wird ignoriert", () => {
		const day = freshDay();
		day.immersionRunSegments.push({
			startTs: 1000,
			endTs: 1000,
			energyKwh: 0,
			runtimeSec: 0,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: null,
			ownershipOwner: null,
		});
		assert.equal(evaluateThermalFindings(day).length, 0);
	});
});

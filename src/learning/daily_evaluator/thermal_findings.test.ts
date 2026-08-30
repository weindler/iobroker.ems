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

/** Baut Slot-Tupel [startMs, value] anhand eines 24-Werte-Arrays (Index = UTC-Stunde). */
function hourlySlotTuples(day: ReturnType<typeof freshDay>, valuesByHour: number[]): Array<[number, number]> {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	return layout.slots.map((s) => [s.startMs, valuesByHour[new Date(s.startMs).getUTCHours()]] as [number, number]);
}

/** Füllt die tatsächlichen (Ist-)Preis-Buckets anhand eines 24-Werte-Arrays. */
function applyActualHourlyPrices(day: ReturnType<typeof freshDay>, valuesByHour: number[]): void {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	for (const slot of layout.slots) {
		day.buckets.priceCtPerKwh[slot.index] = valuesByHour[new Date(slot.startMs).getUTCHours()];
	}
}

/** PV-Ramp 0..23 (Index = UTC-Stunde) — PV-schwach früh, PV-stark spät am Tag. */
const PV_RAMP_BY_HOUR = Array.from({ length: 24 }, (_, h) => h);

/** Preisreihe mit "Preis-Delle" bei Stunde 20 (weit günstiger als der Rest) — für Opportunity-Tests. */
const PRICE_WITH_LATE_DIP_BY_HOUR = [
	0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 1, 21, 22, 23,
];

/** Reale Preisreihe mit Ausreißer-Spitze exakt zur Run-Stunde (14) — für Decision/Outcome-Trennung. */
const ACTUAL_PRICE_SPIKE_AT_HOUR_14 = Array.from({ length: 24 }, (_, h) => (h === 14 ? 100 : 10));

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

	// --- Abnahme-Korrektur #1: späteres besseres Fenster vor thermalEmptyAtIso ---

	it("Thermal reicht bis später, deutlich besseres PV-Fenster vor thermalEmptyAtIso → early/avoidable", () => {
		const day = freshDay();
		cheapExpensivePriceSeries(day);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, Array.from({ length: 24 }, (_, h) => priceAtHour(h))),
			pvSlotKwh: hourlySlotTuples(day, PV_RAMP_BY_HOUR),
			// Run bei Stunde 2 (PV-Perzentil niedrig), thermalEmptyAtIso bei Stunde 20 —
			// dazwischen liegt ein deutlich PV-stärkeres Fenster (z. B. Stunde 10+).
			thermalEmptyAtIso: "2026-06-15T20:00:00.000Z",
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
			hygieneStatusDe: null,
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.ok(
			["early", "avoidable"].includes(findings[0].quality.decisionQuality),
			`erwartet early/avoidable, war ${findings[0].quality.decisionQuality}`,
		);
		assert.ok(findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
	});

	it("deutlich günstigeres Preisfenster vor thermalEmptyAtIso → early/avoidable", () => {
		const day = freshDay();
		applyActualHourlyPrices(day, PRICE_WITH_LATE_DIP_BY_HOUR);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, PRICE_WITH_LATE_DIP_BY_HOUR),
			// Run bei Stunde 14 (reasonable), thermalEmptyAtIso bei Stunde 22 — dazwischen liegt die
			// Preis-Delle bei Stunde 20 (deutlich günstiger, Perzentil-Abstand > 0.3).
			thermalEmptyAtIso: "2026-06-15T22:00:00.000Z",
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
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
		assert.equal(findings[0].quality.decisionQuality, "avoidable");
		assert.ok(findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
	});

	it("besseres Fenster liegt erst NACH thermalEmptyAtIso → NICHT avoidable", () => {
		const day = freshDay();
		applyActualHourlyPrices(day, PRICE_WITH_LATE_DIP_BY_HOUR);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, PRICE_WITH_LATE_DIP_BY_HOUR),
			// thermalEmptyAtIso jetzt VOR der Preis-Delle (Stunde 20) — die Delle darf nicht mehr
			// als Opportunity zählen.
			thermalEmptyAtIso: "2026-06-15T19:00:00.000Z",
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
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
		assert.equal(findings[0].quality.decisionQuality, "reasonable");
		assert.ok(!findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
	});

	it("Hygiene-Pflicht schlägt Opportunity-Bewertung trotz klar besserem Fenster", () => {
		const day = freshDay();
		applyActualHourlyPrices(day, PRICE_WITH_LATE_DIP_BY_HOUR);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, PRICE_WITH_LATE_DIP_BY_HOUR),
			thermalEmptyAtIso: "2026-06-15T22:00:00.000Z",
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
			energyKwh: 1.0,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: false,
			hygieneStatusDe: "Hygiene fällig — Boiler auf >60 °C bringen.",
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "mandatory");
		assert.ok(!findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
	});

	it("forcedMode=true schlägt Opportunity-Bewertung trotz klar besserem Fenster", () => {
		const day = freshDay();
		applyActualHourlyPrices(day, PRICE_WITH_LATE_DIP_BY_HOUR);
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, PRICE_WITH_LATE_DIP_BY_HOUR),
			thermalEmptyAtIso: "2026-06-15T22:00:00.000Z",
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
			energyKwh: 1.0,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
			decisionSource: "daily_plan",
			forcedMode: true,
			hygieneStatusDe: null,
			ownershipOwner: "ems",
		});
		const findings = evaluateThermalFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "reasonable");
		assert.ok(!findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
		assert.ok(findings[0].reasonCodes.includes("forced_mode_active"));
	});

	it("guter damaliger Forecast (+Opportunity), schlechtes reales Outcome → decisionQuality und outcomeQuality bleiben getrennt", () => {
		const day = freshDay();
		// Reales Ist: Preis-Spitze exakt zur Run-Stunde (14) — im Nachhinein ungünstig.
		applyActualHourlyPrices(day, ACTUAL_PRICE_SPIKE_AT_HOUR_14);
		// Damaliger Snapshot: Preis-Delle bei Stunde 20 (Forecast) → Opportunity-Check greift.
		const snap = makeSnapshot({
			tsIso: "2026-06-15T00:00:00.000Z",
			priceSlots: hourlySlotTuples(day, PRICE_WITH_LATE_DIP_BY_HOUR),
			thermalEmptyAtIso: "2026-06-15T22:00:00.000Z",
		});
		day.forecastSnapshots.push(snap);
		day.immersionRunSegments.push({
			startTs: Date.parse("2026-06-15T14:00:00.000Z"),
			endTs: Date.parse("2026-06-15T14:30:00.000Z"),
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
		// decisionQuality: ausschließlich aus dem damaligen Snapshot + Opportunity-Check (Forecast).
		assert.equal(findings[0].quality.decisionQuality, "avoidable");
		assert.ok(findings[0].reasonCodes.includes("better_window_available_before_thermal_empty"));
		// outcomeQuality: ausschließlich aus der tatsächlichen Preisverteilung des Tages — nutzt
		// nie die Opportunity-Logik und weicht hier bewusst von decisionQuality ab.
		assert.equal(findings[0].quality.outcomeQuality, "wasteful");
		assert.notEqual(findings[0].quality.decisionQuality, findings[0].quality.outcomeQuality);
	});
});

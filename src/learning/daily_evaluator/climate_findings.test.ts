import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout } from "../day_telemetry/slots.js";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateClimateFindings } from "./climate_findings.js";

function priceAtHour(hour: number): number {
	return 10 + hour * 1.5;
}

function rampPriceSeries(day: ReturnType<typeof freshDay>): void {
	const layout = buildDaySlotLayout(day.dateKey, day.timezone);
	for (const slot of layout.slots) {
		day.buckets.priceCtPerKwh[slot.index] = priceAtHour(new Date(slot.startMs).getUTCHours());
	}
}

function priceSnapshot(day: ReturnType<typeof freshDay>, overrides: Parameters<typeof makeSnapshot>[0] = {}) {
	return makeSnapshot({
		tsIso: "2026-06-15T00:00:00.000Z",
		priceSlots: buildDaySlotLayout(day.dateKey, day.timezone).slots.map((s) => [
			s.startMs,
			priceAtHour(new Date(s.startMs).getUTCHours()),
		] as [number, number]),
		...overrides,
	});
}

describe("daily_evaluator climate findings", () => {
	it("mandatory=true im Snapshot → mandatory Klassifikation", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				climateUnits: [{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: true, mode: "cool" }],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T23:00:00.000Z"),
			endTs: Date.parse("2026-06-15T23:30:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.8,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].quality.decisionQuality, "mandatory");
	});

	it("nicht mandatory, günstiges Preisfenster → reasonable", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				climateUnits: [{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: false, mode: "cool" }],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T02:00:00.000Z"),
			endTs: Date.parse("2026-06-15T02:30:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.5,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "reasonable");
	});

	it("kein Snapshot vorhanden → unknown + insufficientData (keine Rekonstruktion)", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T10:00:00.000Z"),
			endTs: Date.parse("2026-06-15T10:30:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.4,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
	});

	it("ungültiges Segment → unknown, kein erfundener Energie-/Preisbezug", () => {
		const day = freshDay();
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T10:00:00.000Z"),
			endTs: Date.parse("2026-06-15T10:30:00.000Z"),
			sharedPowerGroupId: null,
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.4,
			runtimeSec: 1800,
			valid: false,
			rejectReason: "shared_power_group_unknown",
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
		assert.ok(findings[0].reasonCodes.includes("shared_power_group_unknown"));
	});
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout } from "../day_telemetry/slots.js";
import { freshDay, makeSnapshot } from "./test_helpers.js";
import { evaluateClimateFindings, evaluateClimatePredictiveDayFindings } from "./climate_findings.js";

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
				climateUnits: [
					{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: true, mode: "cool", hardOffAtIso: null },
				],
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

	it("nicht mandatory, günstiges Preisfenster, ausreichend Zeit bis Hard-Off → reasonable", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
					},
				],
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

	// --- Abnahme-Korrektur #2: Start kurz vor Hard-Off ---

	it("Start kurz vor Hard-Off, niedrige Urgency (<20 Min) → avoidable + late_start_near_hard_off", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T19:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						// Nur 10 Min Restzeit ab Run-Start — unter AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT (20 Min).
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
						// roomTempC == targetTempC → demandUrgency01 = 0 (niedrige Dringlichkeit) via
						// coolingDemandUrgency01 — dieselbe Formel wie die FSM, mit historisierten Rohgrößen.
						roomTempC: 24,
						targetTempC: 24,
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "avoidable");
		assert.equal(findings[0].quality.outcomeQuality, "avoidable");
		assert.ok(findings[0].reasonCodes.includes("late_start_near_hard_off"));
		assert.equal(findings[0].measurements.remainingMinutesUntilHardOff, 10);
		assert.equal(findings[0].measurements.demandUrgency01, 0);
		assert.equal(findings[0].insufficientData, false);
	});

	it("Start kurz vor Hard-Off, hohe Urgency → laut isHardOffStartWorthwhile NICHT avoidable", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T02:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						// Nur 5 Min Restzeit — aber roomTempC 2K über targetTempC → demandUrgency01 = 1.0
						// (volle Referenz-Spanne, AC_URGENCY_REFERENCE_TEMP_K_DEFAULT). Laut
						// isHardOffStartWorthwhile sinkt die geforderte Mindestlaufzeit dann auf 0 Min,
						// 5 Min Restzeit reichen also — Start bleibt wirtschaftlich, nicht avoidable.
						hardOffAtIso: "2026-06-15T02:55:00.000Z",
						roomTempC: 26,
						targetTempC: 24,
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T02:50:00.000Z"),
			endTs: Date.parse("2026-06-15T02:55:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1",
			energyKwh: 0.15,
			runtimeSec: 300,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].measurements.remainingMinutesUntilHardOff, 5);
		assert.equal(findings[0].measurements.demandUrgency01, 1);
		assert.ok(!findings[0].reasonCodes.includes("late_start_near_hard_off"));
		// Fällt bei worthwhile=true auf reine Preis-Klassifikation zurück (günstige Nachtstunde
		// im Ramp-Preis-Fixture) — nicht avoidable, weder durch Hard-Off- noch durch Preis-Grund.
		assert.notEqual(findings[0].quality.decisionQuality, "avoidable");
		assert.ok(findings[0].reasonCodes.includes("price_timed"));
		assert.equal(findings[0].insufficientData, false);
	});

	it("Restzeit < 20 Min, aber historischer Urgency-Kontext (roomTempC/targetTempC) fehlt → insufficient_data", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T19:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
						roomTempC: null,
						targetTempC: null,
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
		assert.ok(findings[0].reasonCodes.includes("hard_off_urgency_context_unknown"));
	});

	it("Alt-Snapshot ohne neue Urgency-Felder (Alt-Daten) → keine Exception, insufficient_data statt Raten", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T19:00:00.000Z",
				climateUnits: [
					// Simuliert einen vor dieser Erweiterung geschriebenen Snapshot: roomTempC/
					// targetTempC/roomHumidityPct/maxHumidityPct fehlen als Keys komplett (nicht nur null).
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
		assert.ok(findings[0].reasonCodes.includes("hard_off_urgency_context_unknown"));
	});

	it("mandatory kurz vor Hard-Off → mandatory Vorrang, kein late_start_near_hard_off", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T19:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: true,
						mode: "cool",
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "mandatory");
		assert.ok(!findings[0].reasonCodes.includes("late_start_near_hard_off"));
	});

	it("hardOffAtIso im Snapshot fehlt (Unit vorhanden, Wert null) → insufficient_data, kein Raten", () => {
		const day = freshDay();
		rampPriceSeries(day);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				climateUnits: [
					{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: false, mode: "cool", hardOffAtIso: null },
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cool",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		assert.equal(findings[0].quality.decisionQuality, "unknown");
		assert.equal(findings[0].insufficientData, true);
		assert.ok(findings[0].reasonCodes.includes("hard_off_context_unknown"));
	});

	it("historisches Snapshot-hardOffAtIso wird verwendet, nicht ein späterer/anderer Wert", () => {
		const day = freshDay();
		rampPriceSeries(day);
		// Früherer Snapshot (vor dem Run) mit abweichendem Hard-Off — muss NICHT verwendet werden,
		// da resolveKnowledgeSnapshotAt den zeitlich nächsten <= Run-Start wählt (der zweite hier).
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T06:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						hardOffAtIso: "2026-06-15T18:00:00.000Z",
						roomTempC: 24,
						targetTempC: 24,
					},
				],
			}),
		);
		day.forecastSnapshots.push(
			priceSnapshot(day, {
				tsIso: "2026-06-15T19:00:00.000Z",
				climateUnits: [
					{
						consumerId: "u1",
						sharedPowerGroupId: "outdoor_1",
						mandatory: false,
						mode: "cool",
						hardOffAtIso: "2026-06-15T20:00:00.000Z",
						roomTempC: 24,
						targetTempC: 24,
					},
				],
			}),
		);
		day.climateRunSegments.push({
			startTs: Date.parse("2026-06-15T19:50:00.000Z"),
			endTs: Date.parse("2026-06-15T20:00:00.000Z"),
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1",
			energyKwh: 0.3,
			runtimeSec: 600,
			valid: true,
			rejectReason: null,
		});
		const findings = evaluateClimateFindings(day);
		// Restzeit muss auf dem zum Entscheidungszeitpunkt (19:00) gültigen hardOffAtIso (20:00)
		// basieren, nicht auf dem älteren Snapshot (18:00, das wäre bereits negativ/überschritten).
		assert.equal(findings[0].measurements.remainingMinutesUntilHardOff, 10);
		assert.equal(findings[0].quality.decisionQuality, "avoidable");
		assert.ok(findings[0].reasonCodes.includes("late_start_near_hard_off"));
	});

	it("alte Snapshots ohne demandModel erzeugen keine predictive-day Findings", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				climateUnits: [
					{
						consumerId: "air_conditioning.unit_1",
						sharedPowerGroupId: null,
						mandatory: false,
						mode: null,
						hardOffAtIso: null,
					},
				],
			}),
		);
		assert.equal(evaluateClimatePredictiveDayFindings(day).length, 0);
	});

	it("demand_model im Snapshot wird als climate_predictive_day dokumentiert", () => {
		const day = freshDay();
		day.forecastSnapshots.push(
			makeSnapshot({
				climateUnits: [
					{
						consumerId: "air_conditioning.unit_1",
						sharedPowerGroupId: null,
						mandatory: false,
						mode: null,
						hardOffAtIso: null,
						demandModel: "bootstrap",
						fallbackReasonDe: "Kein Thermal-Learning — Bootstrap.",
						expectedEnergyKwh: 0,
						expectedRuntimeH: 0,
					},
				],
			}),
		);
		const findings = evaluateClimatePredictiveDayFindings(day);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].eventType, "climate_predictive_day");
		assert.ok(findings[0].reasonCodes.includes("demand_model_bootstrap"));
	});
});

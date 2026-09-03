import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyDayRecord, type ClimateUnitSlotSample, type DayTelemetryDayRecord } from "../day_telemetry/types";
import { DAY_TELEMETRY_SLOT_MS } from "../day_telemetry/constants";
import { buildDaySlotLayout } from "../day_telemetry/slots";
import {
	CLIMATE_THERMAL_MIN_SAMPLES,
	collectActiveTempSamples,
	collectDehumidifyHumiditySamples,
	collectPassiveTempSamples,
	computeClimateThermalUnitModel,
	thermalTestSegment,
} from "./math";

function dayWithSlots(opts: {
	dateKey?: string;
	unitTemps: Array<{ running: boolean; purpose: ClimateUnitSlotSample["modePurpose"]; temp: number | null; hum?: number | null; override?: boolean }>;
	startHour?: number;
}): DayTelemetryDayRecord {
	const dateKey = opts.dateKey ?? "2026-08-01";
	const layout = buildDaySlotLayout(dateKey, "Europe/Berlin");
	const day = emptyDayRecord(dateKey, "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
	const start = opts.startHour ?? 10;
	const startSlot = Math.floor((start * 3600_000) / DAY_TELEMETRY_SLOT_MS);
	for (let i = 0; i < opts.unitTemps.length; i++) {
		const src = opts.unitTemps[i]!;
		const idx = startSlot + i;
		if (idx >= day.slotCount) break;
		const sample: ClimateUnitSlotSample = {
			unitIndex: 1,
			roomTempC: src.temp,
			roomHumidityPct: src.hum ?? 50,
			targetTempC: 17,
			coolingOnTempC: 26,
			coolingOffTempC: 24,
			heatingSetpointC: null,
			maxHumidityPct: 60,
			modesAvailable: ["cooling"],
			running: src.running,
			modePurpose: src.purpose,
			hardOffAt: "20:00",
			demandUrgency01: null,
			ownershipOwner: "ems",
			overrideActive: src.override === true,
			plannedEnergyKwh: null,
			sharedPowerGroupId: "outdoor_1",
			activeUnitCombination: src.running ? "1" : null,
		};
		day.buckets.climateUnitSlots[idx] = [sample];
		day.buckets.outdoorTempC[idx] = 28;
	}
	return day;
}

function manyPassiveDays(rateKPerH: number, count: number, startDate = "2026-07-01"): DayTelemetryDayRecord[] {
	const days: DayTelemetryDayRecord[] = [];
	for (let d = 0; d < count; d++) {
		const dateKey = `2026-07-${String(d + 1).padStart(2, "0")}`;
		/* 8 Slots = 2h passive */
		const temps: Array<{ running: boolean; purpose: ClimateUnitSlotSample["modePurpose"]; temp: number | null }> = [];
		for (let s = 0; s < 8; s++) {
			temps.push({ running: false, purpose: "off", temp: 24 + rateKPerH * (s * 0.25) });
		}
		days.push(dayWithSlots({ dateKey, unitTemps: temps }));
	}
	return days;
}

describe("climate thermal math", () => {
	it("lernt passive Erwärmung und Abkühlung getrennt, ohne 0 zu erfinden", () => {
		const warm = dayWithSlots({
			dateKey: "2026-07-01",
			unitTemps: Array.from({ length: 8 }, (_, i) => ({
				running: false,
				purpose: "off" as const,
				temp: 22 + i * 0.3,
			})),
		});
		const cool = dayWithSlots({
			dateKey: "2026-07-02",
			unitTemps: Array.from({ length: 8 }, (_, i) => ({
				running: false,
				purpose: "off" as const,
				temp: 26 - i * 0.2,
			})),
		});
		const samples = collectPassiveTempSamples([warm, cool], 1);
		assert.equal(samples.length, 2);
		assert.ok(samples[0]!.rate > 0);
		assert.ok(samples[1]!.rate < 0);
	});

	it("verwirft Messsprünge und kurze Segmente", () => {
		const jump = dayWithSlots({
			unitTemps: [
				{ running: false, purpose: "off", temp: 22 },
				{ running: false, purpose: "off", temp: 28 },
				{ running: false, purpose: "off", temp: 28.1 },
			],
		});
		assert.equal(collectPassiveTempSamples([jump], 1).length, 0);

		const short = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		short.climateRunSegments = [thermalTestSegment({ runtimeSec: 120, energyKwh: 0.02 })];
		assert.equal(collectActiveTempSamples([short], 1, "cooling").length, 0);
	});

	it("Cooling-Wirkung aus echten Segmenten; Mode-Wechsel nicht vermischen", () => {
		const day = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		day.climateRunSegments = [
			thermalTestSegment({
				mode: "cooling",
				runtimeSec: 1800,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 27,
						roomTempEndC: 25.2,
						roomHumidityStartPct: 55,
						roomHumidityEndPct: 54,
						overrideActive: false,
					},
				],
			}),
			thermalTestSegment({
				mode: "heating",
				runtimeSec: 1800,
				endTs: 4_000_000,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 18,
						roomTempEndC: 20,
						roomHumidityStartPct: 40,
						roomHumidityEndPct: 39,
						overrideActive: false,
					},
				],
			}),
		];
		const cooling = collectActiveTempSamples([day], 1, "cooling");
		const heating = collectActiveTempSamples([day], 1, "heating");
		assert.equal(cooling.length, 1);
		assert.ok(cooling[0]!.rate < 0);
		assert.equal(heating.length, 1);
		assert.ok(heating[0]!.rate > 0);
	});

	it("Heating disabled ohne Segmente → unavailable, kein 0-Sample", () => {
		const model = computeClimateThermalUnitModel(
			[],
			{ unitIndex: 1, enabled: true, modesAvailable: ["cooling"] },
			Date.now(),
		);
		assert.equal(model.heating.status, "unavailable");
		assert.equal(model.heating.rate, null);
		assert.equal(model.heating.usable, false);
		assert.equal(model.heating.sampleCount, 0);
		assert.match(model.heating.reasonDe, /nicht verfügbar/);
	});

	it("Dehumidify lernt Feuchte- und Temperatur-Nebeneffekt getrennt", () => {
		const day = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		day.climateRunSegments = [
			thermalTestSegment({
				mode: "dehumidify",
				runtimeSec: 1800,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 24,
						roomTempEndC: 23.7,
						roomHumidityStartPct: 70,
						roomHumidityEndPct: 62,
						overrideActive: false,
					},
				],
			}),
		];
		const hum = collectDehumidifyHumiditySamples([day], 1);
		const temp = collectActiveTempSamples([day], 1, "dehumidify");
		assert.equal(hum.length, 1);
		assert.ok(hum[0]!.rate < 0);
		assert.equal(temp.length, 1);
		assert.ok(temp[0]!.rate < 0);
	});

	it("Manual-/External-Override wird vom automatischen Lernen ausgeschlossen", () => {
		const day = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		day.climateRunSegments = [
			thermalTestSegment({
				overrideActive: true,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 27,
						roomTempEndC: 25,
						roomHumidityStartPct: 50,
						roomHumidityEndPct: 49,
						overrideActive: true,
					},
				],
			}),
		];
		const model = computeClimateThermalUnitModel(
			[day],
			{ unitIndex: 1, enabled: true, modesAvailable: ["cooling"] },
			Date.now(),
		);
		assert.equal(model.cooling.sampleCount, 0);
		assert.equal(model.cooling.usable, false);
	});

	it("Shared Solo vs Kombination bleibt als Kontext getrennt, kWh nicht aufgeteilt", () => {
		const day = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		day.climateRunSegments = [
			thermalTestSegment({
				activeUnitCombination: "1",
				energyKwh: 0.35,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 27,
						roomTempEndC: 25.5,
						roomHumidityStartPct: 50,
						roomHumidityEndPct: 49,
						overrideActive: false,
					},
				],
			}),
			thermalTestSegment({
				activeUnitCombination: "1+2",
				energyKwh: 0.5,
				endTs: 5_000_000,
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: 27,
						roomTempEndC: 26,
						roomHumidityStartPct: 50,
						roomHumidityEndPct: 49,
						overrideActive: false,
					},
					{
						unitIndex: 2,
						roomTempStartC: 26,
						roomTempEndC: 25.2,
						roomHumidityStartPct: 48,
						roomHumidityEndPct: 47,
						overrideActive: false,
					},
				],
			}),
		];
		const solo = collectActiveTempSamples([day], 1, "cooling").filter((s) => s.solo);
		const shared = collectActiveTempSamples([day], 1, "cooling").filter((s) => !s.solo);
		assert.equal(solo.length, 1);
		assert.equal(shared.length, 1);
		assert.equal(day.climateRunSegments[1]!.energyKwh, 0.5);
	});

	it("usable bleibt bei zu wenig Daten false; hohe Streuung senkt Confidence / usable", () => {
		const few = manyPassiveDays(0.4, 3);
		const fewModel = computeClimateThermalUnitModel(
			few,
			{ unitIndex: 1, enabled: true, modesAvailable: ["cooling"] },
			Date.now(),
		);
		assert.ok(fewModel.passive.sampleCount < CLIMATE_THERMAL_MIN_SAMPLES);
		assert.equal(fewModel.passive.usable, false);

		const days: DayTelemetryDayRecord[] = [];
		for (let i = 0; i < 12; i++) {
			const rate = i % 2 === 0 ? 0.2 : 3.5;
			days.push(
				dayWithSlots({
					dateKey: `2026-07-${String(i + 1).padStart(2, "0")}`,
					unitTemps: Array.from({ length: 8 }, (_, s) => ({
						running: false,
						purpose: "off" as const,
						temp: 22 + rate * (s * 0.25),
					})),
				}),
			);
		}
		const spread = computeClimateThermalUnitModel(
			days,
			{ unitIndex: 1, enabled: true, modesAvailable: ["cooling"] },
			Date.now(),
		);
		assert.ok(spread.passive.sampleCount >= CLIMATE_THERMAL_MIN_SAMPLES);
		assert.equal(spread.passive.usable, false);
		assert.ok(spread.passive.confidence < 0.7);
	});

	it("genug homogene Passive-Samples → usable true", () => {
		const days = manyPassiveDays(0.35, 12);
		const model = computeClimateThermalUnitModel(
			days,
			{ unitIndex: 1, enabled: true, modesAvailable: ["cooling"] },
			Date.parse("2026-07-13T12:00:00Z"),
		);
		assert.ok(model.passive.sampleCount >= CLIMATE_THERMAL_MIN_SAMPLES);
		assert.equal(model.passive.usable, true);
		assert.ok(model.passive.rate != null && model.passive.rate > 0);
		assert.ok(model.passive.warmingRateKPerH != null);
	});

	it("schlechte Daten (fehlende Raumtemperatur) erzeugen kein Sample", () => {
		const day = emptyDayRecord("2026-07-01", "Europe/Berlin", 0, 86_400_000, 96);
		day.climateRunSegments = [
			thermalTestSegment({
				unitObservations: [
					{
						unitIndex: 1,
						roomTempStartC: null,
						roomTempEndC: null,
						roomHumidityStartPct: null,
						roomHumidityEndPct: null,
						overrideActive: false,
					},
				],
			}),
		];
		assert.equal(collectActiveTempSamples([day], 1, "cooling").length, 0);
	});
});

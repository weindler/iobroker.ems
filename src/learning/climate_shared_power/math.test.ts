import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	climateSharedPowerKey,
	computeClimateSharedPowerStats,
	parseClimateSharedPowerKey,
	resolveClimateSharedPowerW,
	trimOutliersIqr,
	type ClimateSharedPowerSampleInput,
} from "./math";

const DAY_MS = 86_400_000;

function seg(
	overrides: Partial<ClimateSharedPowerSampleInput> = {},
): ClimateSharedPowerSampleInput {
	return {
		sharedPowerGroupId: "outdoor_1",
		mode: "cooling",
		activeUnitCombination: "1",
		energyKwh: 0.35, // 700 W über 30 Min
		runtimeSec: 1800,
		valid: true,
		endTs: Date.now(),
		...overrides,
	};
}

describe("climate_shared_power math", () => {
	it("Key-Roundtrip: climateSharedPowerKey/parseClimateSharedPowerKey", () => {
		const key = climateSharedPowerKey("outdoor_1", "cooling", "1+2");
		assert.equal(key, "outdoor_1|cooling|1+2");
		const parsed = parseClimateSharedPowerKey(key);
		assert.deepEqual(parsed, {
			sharedPowerGroupId: "outdoor_1",
			mode: "cooling",
			activeUnitCombination: "1+2",
		});
	});

	it("ignoriert Segmente ohne sharedPowerGroupId (eigenständige Units bleiben bei consumer_stats)", () => {
		const stats = computeClimateSharedPowerStats(
			[seg({ sharedPowerGroupId: null }), seg({ sharedPowerGroupId: null })],
			Date.now(),
		);
		assert.deepEqual(stats, {});
	});

	it("ignoriert ungültige Segmente (valid=false) und Anlaufphasen (< Mindestlaufzeit)", () => {
		const now = Date.now();
		const stats = computeClimateSharedPowerStats(
			[
				seg({ valid: false, endTs: now }),
				seg({ runtimeSec: 60, endTs: now }), // < 300s Mindestlaufzeit
			],
			now,
		);
		assert.deepEqual(stats, {});
	});

	it("trennt Solo- und Kombi-Betrieb strikt in unterschiedliche Keys (keine Vermischung)", () => {
		const now = Date.now();
		const segments: ClimateSharedPowerSampleInput[] = [
			// Josef alleine: 700 W, mehrere Tage
			...Array.from({ length: 5 }, (_, i) =>
				seg({ activeUnitCombination: "2", energyKwh: 0.35, runtimeSec: 1800, endTs: now - i * DAY_MS }),
			),
			// Wohnzimmer+Josef gemeinsam: Außengerät zieht mehr (1000 W), NICHT 700+700
			...Array.from({ length: 5 }, (_, i) =>
				seg({ activeUnitCombination: "1+2", energyKwh: 0.5, runtimeSec: 1800, endTs: now - i * DAY_MS }),
			),
		];
		const stats = computeClimateSharedPowerStats(segments, now);
		const solo = stats[climateSharedPowerKey("outdoor_1", "cooling", "2")];
		const combo = stats[climateSharedPowerKey("outdoor_1", "cooling", "1+2")];
		assert.ok(solo, "Solo-Key fehlt");
		assert.ok(combo, "Kombi-Key fehlt");
		assert.equal(solo.medianPowerW, 700);
		assert.equal(combo.medianPowerW, 1000);
		// Kombi-Wert darf NICHT die Summe zweier Solo-Werte sein (700+700=1400) — reale Messung führt.
		assert.notEqual(combo.medianPowerW, 1400);
	});

	it("robuste Ausreißerfilterung (IQR-Fences) verwirft einzelne Sensor-Spikes", () => {
		const values = [700, 705, 698, 702, 699, 5000, 701];
		const trimmed = trimOutliersIqr(values);
		assert.ok(!trimmed.includes(5000), "Ausreißer 5000 wurde nicht entfernt");
		assert.ok(trimmed.length >= 5);
	});

	it("Confidence bleibt 0 unterhalb der Mindest-Sample-Anzahl — kein Learning-Wert ohne Beleg", () => {
		const now = Date.now();
		const stats = computeClimateSharedPowerStats(
			[seg({ endTs: now }), seg({ endTs: now - DAY_MS })],
			now,
		);
		const stat = stats[climateSharedPowerKey("outdoor_1", "cooling", "1")]!;
		assert.equal(stat.sampleCount, 2);
		assert.equal(stat.confidence, 0);
	});

	it("Confidence steigt mit Sample-Anzahl und sinkt mit Alter", () => {
		const now = Date.now();
		const fresh = computeClimateSharedPowerStats(
			Array.from({ length: 10 }, (_, i) => seg({ endTs: now - i * 3600_000 })),
			now,
		)[climateSharedPowerKey("outdoor_1", "cooling", "1")]!;
		const old = computeClimateSharedPowerStats(
			Array.from({ length: 10 }, (_, i) => seg({ endTs: now - 95 * DAY_MS - i * 3600_000 })),
			now,
		)[climateSharedPowerKey("outdoor_1", "cooling", "1")]!;
		assert.ok(fresh.confidence > 0.9, `frische Confidence zu niedrig: ${fresh.confidence}`);
		assert.equal(old.confidence, 0, "über 90 Tage alte Probe muss auf Confidence 0 abklingen");
	});

	it("Reliability-Gate: unzureichende Confidence → Config-Fallback statt Learning-Wert", () => {
		const stat = computeClimateSharedPowerStats(
			[seg(), seg({ endTs: Date.now() - DAY_MS })],
			Date.now(),
		)[climateSharedPowerKey("outdoor_1", "cooling", "1")];
		const resolution = resolveClimateSharedPowerW(stat, 650);
		assert.equal(resolution.source, "config");
		assert.equal(resolution.powerW, 650);
	});

	it("Reliability-Gate: ausreichende Confidence → gelernter p75-Wert (konservativ, nicht Median)", () => {
		const now = Date.now();
		const segments = [600, 650, 700, 750, 800, 700, 700, 700, 700, 700].map((w, i) =>
			seg({ energyKwh: (w * 0.5) / 1000, runtimeSec: 1800, endTs: now - i * 3600_000 }),
		);
		const stat = computeClimateSharedPowerStats(segments, now)[
			climateSharedPowerKey("outdoor_1", "cooling", "1")
		];
		const resolution = resolveClimateSharedPowerW(stat, 700);
		assert.equal(resolution.source, "learned");
		assert.ok(resolution.powerW >= stat!.medianPowerW!, "p75 muss >= Median sein (konservativ)");
	});

	it("keine erfundenen Werte: ohne jegliches Sample bleibt Stat für diesen Key undefined", () => {
		const stats = computeClimateSharedPowerStats([], Date.now());
		assert.deepEqual(stats, {});
		const resolution = resolveClimateSharedPowerW(undefined, 700);
		assert.equal(resolution.source, "config");
		assert.equal(resolution.sampleCount, 0);
	});
});

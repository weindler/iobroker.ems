import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAcSystemPower, totalAcSystemPowerW, type AcUnitLiveState } from "./shared_power.js";

function wohnzimmer(over: Partial<AcUnitLiveState> = {}): AcUnitLiveState {
	return {
		unitIndex: 1,
		sharedPowerGroupId: "outdoor_1",
		running: false,
		measuredPowerW: null, // kein eigener Sensor
		estimatedPowerW: 900,
		...over,
	};
}

function josef(over: Partial<AcUnitLiveState> = {}): AcUnitLiveState {
	return {
		unitIndex: 2,
		sharedPowerGroupId: "outdoor_1",
		running: false,
		measuredPowerW: null,
		estimatedPowerW: 700,
		...over,
	};
}

describe("resolveAcSystemPower — gemeinsame Außengeräte-Leistung", () => {
	it("nur Wohnzimmer aktiv, Josef-Sensor liefert Gesamtleistung → genau einmal zählen", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: true }),
			josef({ running: false, measuredPowerW: 115 }), // Sensor am Außengerät, unabhängig vom eigenen running
		]);
		assert.equal(results.length, 1);
		const r = results[0]!;
		assert.equal(r.totalPowerW, 115);
		assert.deepEqual(r.activeUnitIndexes, [1]);
		assert.equal(r.sharedMeasurementUsed, true);
		assert.equal(r.measurementUnitIndex, 2);
		assert.equal(totalAcSystemPowerW(results), 115);
	});

	it("nur Josef aktiv → genau einmal zählen", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: false }),
			josef({ running: true, measuredPowerW: 620 }),
		]);
		assert.equal(results.length, 1);
		const r = results[0]!;
		assert.equal(r.totalPowerW, 620);
		assert.deepEqual(r.activeUnitIndexes, [2]);
		assert.equal(r.sharedMeasurementUsed, true);
	});

	it("beide aktiv → Gesamtleistung weiterhin nur einmal zählen (keine Addition)", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: true }),
			josef({ running: true, measuredPowerW: 1350 }),
		]);
		assert.equal(results.length, 1);
		const r = results[0]!;
		// NICHT 1350 + geschätzte Wohnzimmer-Leistung — nur der eine gemessene Wert.
		assert.equal(r.totalPowerW, 1350);
		assert.deepEqual(r.activeUnitIndexes, [1, 2]);
		assert.equal(r.sharedMeasurementUsed, true);
		assert.equal(r.measurementUnitIndex, 2);
	});

	it("keine Units der Gruppe aktiv → 0 W, keine erfundene Standby-Leistung", () => {
		const results = resolveAcSystemPower([wohnzimmer(), josef({ measuredPowerW: 12 })]);
		assert.equal(results[0]!.totalPowerW, 0);
		assert.deepEqual(results[0]!.activeUnitIndexes, []);
	});

	it("Gruppe ohne reale Messung fällt konservativ auf max(Schätzung) zurück — keine Summe", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: true, estimatedPowerW: 900 }),
			josef({ running: true, estimatedPowerW: 700, measuredPowerW: null }),
		]);
		assert.equal(results[0]!.sharedMeasurementUsed, false);
		assert.equal(results[0]!.totalPowerW, 900, "max(900,700) — nie 1600");
	});

	it("verschiedene sharedPowerGroupId bleiben elektrisch getrennt (Summe erlaubt)", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: true, estimatedPowerW: 850, measuredPowerW: null }),
			{
				unitIndex: 3,
				sharedPowerGroupId: "outdoor_2",
				running: true,
				measuredPowerW: null,
				estimatedPowerW: 600,
			},
		]);
		assert.equal(results.length, 2);
		assert.equal(totalAcSystemPowerW(results), 850 + 600);
	});

	it("Units ohne sharedPowerGroupId bleiben unverändert eigenständig (Rückwärtskompatibilität)", () => {
		const results = resolveAcSystemPower([
			{ unitIndex: 3, sharedPowerGroupId: null, running: true, measuredPowerW: 800, estimatedPowerW: 750 },
			{ unitIndex: 4, sharedPowerGroupId: null, running: false, measuredPowerW: null, estimatedPowerW: 500 },
		]);
		assert.equal(results.length, 2);
		const u3 = results.find((r) => r.activeUnitIndexes.includes(3))!;
		assert.equal(u3.totalPowerW, 800);
		const u4 = results.find((r) => r.groupId === null && r.activeUnitIndexes.length === 0)!;
		assert.equal(u4.totalPowerW, 0);
	});

	it("keine Doppelzählung in der System-Gesamtsumme über mehrere Gruppen + Standalone", () => {
		const results = resolveAcSystemPower([
			wohnzimmer({ running: true }),
			josef({ running: true, measuredPowerW: 1350 }),
			{ unitIndex: 5, sharedPowerGroupId: null, running: true, measuredPowerW: 400, estimatedPowerW: 400 },
		]);
		assert.equal(totalAcSystemPowerW(results), 1350 + 400);
	});
});

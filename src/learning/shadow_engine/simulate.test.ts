import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyDayRecord } from "../day_telemetry/types";
import {
	computeRealDayResult,
	simulateEmsWithoutAi,
	simulateReferenceNoEms,
	simulateReferenceSonnenNative,
} from "./simulate";

function fixtureDay(slotCount = 4) {
	const day = emptyDayRecord("2026-08-30", "Europe/Berlin", 0, slotCount * 15 * 60_000, slotCount);
	day.complete = true;
	day.evaluable = true;
	return day;
}

describe("computeRealDayResult", () => {
	it("aggregiert Import/Export/Kosten aus den Buckets", () => {
		const day = fixtureDay(4);
		day.buckets.gridImportKwh = [1, 1, 0, 0];
		day.buckets.gridExportKwh = [0, 0, 2, 2];
		day.buckets.priceCtPerKwh = [30, 30, 10, 10];
		day.buckets.batterySocEndPct = [80, 75, 90, 95];
		const r = computeRealDayResult(day, 8);
		assert.equal(r.gridImportKwh, 2);
		assert.equal(r.gridExportKwh, 4);
		assert.equal(r.importCostEur, 0.6);
		assert.equal(r.exportCreditEur, 0.32);
		assert.equal(r.netCostEur, 0.28);
		assert.equal(r.socStartPct, 80);
		assert.equal(r.socEndPct, 95);
		assert.equal(r.missingSlotCount, 0);
	});

	it("liefert netCostEur=null statt erfundenen Wert, wenn kein Preis bekannt ist", () => {
		const day = fixtureDay(2);
		day.buckets.gridImportKwh = [1, 1];
		day.buckets.priceCtPerKwh = [null, null];
		const r = computeRealDayResult(day, null);
		assert.equal(r.netCostEur, null);
		assert.equal(r.gridImportKwh, 2);
	});

	it("zählt vollständig fehlende Slots als missing statt 0", () => {
		const day = fixtureDay(3);
		day.buckets.gridImportKwh = [1, null, null];
		day.buckets.priceCtPerKwh = [10, null, null];
		const r = computeRealDayResult(day, null);
		assert.equal(r.missingSlotCount, 2);
		assert.equal(r.observedSlotCount, 1);
	});
});

describe("simulateReferenceNoEms", () => {
	it("nicht bewertbar ohne Batteriekapazität/SOC-Grenzen — keine erfundene Aussage", () => {
		const day = fixtureDay(4);
		const r = simulateReferenceNoEms(
			day,
			{ usableCapacityKwh: null, minSocPct: 5, maxSocPct: 100, maxChargeW: null, maxDischargeW: null, startSocPct: 50 },
			null,
		);
		assert.equal(r.evaluable, false);
		assert.equal(r.netCostEur, null);
	});

	it("simuliert Netzbezug/-einspeisung deterministisch aus PV/Hauslast der Buckets", () => {
		const day = fixtureDay(2);
		day.buckets.pvKwh = [3, 0];
		day.buckets.houseTotalKwh = [1, 1];
		day.buckets.priceCtPerKwh = [20, 20];
		const r = simulateReferenceNoEms(
			day,
			{ usableCapacityKwh: 10, minSocPct: 5, maxSocPct: 100, maxChargeW: null, maxDischargeW: null, startSocPct: 50 },
			8,
		);
		assert.equal(r.evaluable, true);
		assert.equal(r.strategy, "reference_no_ems");
		assert.ok(r.assumptionsDe.length > 0);
		assert.ok((r.batteryChargeKwh ?? 0) > 0, "Überschuss der Slot 0 sollte Batterie laden");
	});
});

describe("simulateReferenceNoEms — Point-in-time, kein Future Leakage", () => {
	it("Forecast-Snapshots auf dem Tag ändern die naive Eigenverbrauchslogik nicht", () => {
		const day = fixtureDay(2);
		day.buckets.pvKwh = [3, 0];
		day.buckets.houseTotalKwh = [1, 1];
		day.buckets.priceCtPerKwh = [20, 20];
		const params = {
			usableCapacityKwh: 10,
			minSocPct: 5,
			maxSocPct: 100,
			maxChargeW: null,
			maxDischargeW: null,
			startSocPct: 50,
		};
		const without = simulateReferenceNoEms(day, params, 8);
		day.forecastSnapshots = [
			{
				id: "future",
				tsIso: "2026-08-30T08:00:00.000Z",
				date: "2026-08-30",
				timezone: "Europe/Berlin",
				globalMode: "balanced",
				contributionRevision: null,
				pvExpectedDayKwh: 99,
				houseLoadExpectedDayKwh: 1,
				batterySocPct: 50,
				batteryCapacityKwh: 10,
				batteryNightReserveKwh: 2,
				priceSlots: [[0, 99]],
				pvSlotKwh: [[0, 50]],
				wallboxRequiredEnergyKwh: null,
				wallboxDeadlineIso: null,
				wallboxConnected: null,
				wallboxPresenceDigest: null,
				thermalBufferTempC: null,
				thermalEmptyAtIso: null,
				thermalHeadroomKwh: null,
				climateUnits: [],
				wallboxTargetSocPct: null,
				wallboxMinimumDepartureSocPct: null,
				wallboxEnergyGoalHard: null,
				wallboxManagementMode: null,
				batteryDecision: null,
			},
		];
		const withSnap = simulateReferenceNoEms(day, params, 8);
		assert.equal(withSnap.netCostEur, without.netCostEur);
		assert.equal(withSnap.gridImportKwh, without.gridImportKwh);
		assert.equal(withSnap.batteryChargeKwh, without.batteryChargeKwh);
	});
});

describe("simulateEmsWithoutAi", () => {
	it("entspricht exakt dem realen Tag, solange kein KI-Override aktiv war", () => {
		const day = fixtureDay(2);
		day.buckets.gridImportKwh = [1, 0];
		day.buckets.priceCtPerKwh = [30, 30];
		const real = computeRealDayResult(day, null);
		const r = simulateEmsWithoutAi(real, false);
		assert.equal(r.evaluable, true);
		assert.equal(r.netCostEur, real.netCostEur);
		assert.equal(r.gridImportKwh, real.gridImportKwh);
	});

	it("markiert Tag als nicht bewertbar statt zu schätzen, wenn ein KI-Override aktiv war", () => {
		const day = fixtureDay(2);
		day.buckets.gridImportKwh = [1, 0];
		day.buckets.priceCtPerKwh = [30, 30];
		const real = computeRealDayResult(day, null);
		const r = simulateEmsWithoutAi(real, true);
		assert.equal(r.evaluable, false);
		assert.equal(r.netCostEur, null);
	});
});

describe("Shadow-Dreiteilung", () => {
	it("reference_no_ems bleibt Ideal-Benchmark (Greedy), nicht reale Sonnen", () => {
		const day = fixtureDay(2);
		day.buckets.pvKwh = [0, 0];
		day.buckets.houseTotalKwh = [1, 1];
		day.buckets.priceCtPerKwh = [40, 40];
		const r = simulateReferenceNoEms(
			day,
			{ usableCapacityKwh: 10, minSocPct: 5, maxSocPct: 100, maxChargeW: null, maxDischargeW: null, startSocPct: 80 },
			8,
		);
		assert.match(r.assumptionsDe.join(" "), /IDEAL-BENCHMARK/);
	});

	it("reference_sonnen_native ist ohne α/β nicht bewertbar (kein 0 €)", () => {
		const day = fixtureDay(2);
		day.buckets.gridImportKwh = [0.1, 0.1];
		day.buckets.gridBalanceDischargeKwh = [0.2, 0.2];
		day.buckets.priceCtPerKwh = [40, 40];
		const real = computeRealDayResult(day, 8);
		const r = simulateReferenceSonnenNative(real, day, { usable: false, alpha: null, beta: null }, 8);
		assert.equal(r.evaluable, false);
		assert.equal(r.netCostEur, null);
	});

	it("reference_sonnen_native addiert α×E_gb als vermiedenen Import", () => {
		const day = fixtureDay(2);
		day.buckets.gridImportKwh = [0.05, 0.05];
		day.buckets.gridBalanceDischargeKwh = [0.2, 0.1];
		day.buckets.priceCtPerKwh = [40, 40];
		day.buckets.batteryDischargedKwh = [0.3, 0.2];
		const real = computeRealDayResult(day, 8);
		const r = simulateReferenceSonnenNative(real, day, { usable: true, alpha: 0.5, beta: 1.0 }, 8);
		assert.equal(r.evaluable, true);
		assert.ok((r.gridImportKwh ?? 0) > (real.gridImportKwh ?? 0));
	});
});

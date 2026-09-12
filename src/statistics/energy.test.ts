import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY_TELEMETRY_SLOT_MS } from "../learning/day_telemetry/constants";
import { DOMAIN_QUALITY, encodeQualityMask } from "../learning/day_telemetry/quality_mask";
import { emptyDayRecord, type PlannerKnowledgeSnapshot } from "../learning/day_telemetry/types";
import { buildEnergeticDayTotals, sumEnergeticDays } from "./energy";

function fixture(dateKey = "2026-09-10") {
	const startMs = Date.parse(`${dateKey}T00:00:00+02:00`);
	const day = emptyDayRecord(dateKey, "Europe/Berlin", startMs, startMs + DAY_TELEMETRY_SLOT_MS * 4, 4);
	day.coveragePct = 75;
	day.buckets.pvKwh = [2, 0, 1, null];
	day.buckets.houseTotalKwh = [2, 1, 0.5, null];
	day.buckets.gridImportKwh = [0, 0.5, 0, null];
	day.buckets.gridExportKwh = [0.5, 0, 0.25, null];
	day.buckets.batteryChargedKwh = [0.4, 0, 0.2, null];
	day.buckets.batteryDischargedKwh = [0, 0.1, 0, null];
	day.buckets.batteryChargeSource = ["pv", null, "mixed", null];
	day.buckets.immersionKwh = [0.5, 0, 0.2, null];
	day.buckets.evChargedKwh = [0, 0.4, 0, null];
	day.buckets.evFastChargedKwh = [0, 0.4, 0, null];
	day.buckets.climateElecSharedKwh = [0.2, 0, 0.1, null];
	day.buckets.gridBalanceDischargeKwh = [0, 0.1, 0, null];
	return day;
}

describe("energetische Statistik", () => {
	it("berechnet Eigenverbrauch, Autarkie und gemessene Geräte-PV-Anteile", () => {
		const result = buildEnergeticDayTotals(fixture());
		assert.equal(result.pvGenerationKwh, 3);
		assert.equal(result.selfConsumptionKwh, 2.25);
		assert.equal(result.selfConsumptionPct, 75);
		assert.equal(result.autonomyPct, 85.7);
		assert.equal(result.immersionEnergyKwh, 0.7);
		assert.equal(result.immersionPvKwh, 0.575);
		assert.equal(result.immersionPvSharePct, 82.1);
		assert.equal(result.evPvKwh, 0);
		assert.equal(result.evFastChargedKwh, 0.4);
		assert.equal(result.evFastBatteryKwh, 0.04);
		assert.equal(result.evFastBatterySharePct, 10);
		assert.equal(result.evFastGridKwh, 0.2);
		assert.equal(result.evFastGridSharePct, 50);
		assert.equal(result.evFastLocalKwh, 0.16);
		assert.equal(result.evFastLocalSharePct, 40);
		assert.equal(result.climatePvKwh, 0.25);
		assert.equal(result.batteryPvChargedKwh, null, "mixed darf nicht als PV erfunden werden");
	});

	it("lässt Schnellmodus-Quellen bei einer Messlücke null, aber behält die Schnelllade-Energie", () => {
		const day = fixture();
		day.buckets.batteryDischargedKwh[1] = null;
		const result = buildEnergeticDayTotals(day);
		assert.equal(result.evFastChargedKwh, 0.4);
		assert.equal(result.evFastBatteryKwh, null);
		assert.equal(result.evFastGridKwh, null);
		assert.equal(result.evFastLocalKwh, null);
		assert.match(result.notesDe.join(" "), /Schnellmodus-Quellen nicht bestimmbar/);
	});

	it("erfindet ohne vollständige EVCC-Modusspur keine Schnellladung", () => {
		const day = fixture();
		day.buckets.evFastChargedKwh![1] = null;
		const result = buildEnergeticDayTotals(day);
		assert.equal(result.evChargedKwh, 0.4);
		assert.equal(result.evFastChargedKwh, null);
		assert.equal(result.evFastGridKwh, null);
		assert.match(result.notesDe.join(" "), /EVCC-Modus/);
	});

	it("lässt den Geräte-PV-Anteil bei einer Lücke null", () => {
		const day = fixture();
		day.buckets.gridExportKwh[0] = null;
		const result = buildEnergeticDayTotals(day);
		assert.equal(result.immersionEnergyKwh, 0.7);
		assert.equal(result.immersionPvKwh, null);
		assert.equal(result.immersionPvSharePct, null);
		assert.match(result.notesDe.join(" "), /nicht bestimmbar/);
	});

	it("weist Batterieverlust nur mit vollständiger Tagesrand-Messkette aus", () => {
		const day = fixture();
		day.complete = true;
		day.evaluable = true;
		day.coveragePct = 100;
		day.firstSampleMs = day.startMs;
		day.lastSampleMs = day.endMs - 1;
		day.buckets.qualityMask = Array.from({ length: 4 }, () =>
			encodeQualityMask({ BATTERY: DOMAIN_QUALITY.ok }),
		);
		day.buckets.batterySocEndPct = [40, 45, 48, 50];
		day.buckets.batteryChargedKwh = [0.5, 0.5, 0.5, 0.5];
		day.buckets.batteryDischargedKwh = [0.2, 0.2, 0.2, 0.2];
		day.buckets.batteryChargeSource = ["pv", "pv", "grid", "grid"];
		day.forecastSnapshots = [
			{ batteryCapacityKwh: 10 } as PlannerKnowledgeSnapshot,
		];
		const result = buildEnergeticDayTotals(day);
		assert.equal(result.batteryMeasuredLossKwh, 0.2);

		day.lastSampleMs = day.endMs - DAY_TELEMETRY_SLOT_MS * 3;
		assert.equal(buildEnergeticDayTotals(day).batteryMeasuredLossKwh, null);
	});

	it("aggregiert Prozentwerte energiemengengewichtet und lässt unbelegte Nutzen unmonetarisiert", () => {
		const first = buildEnergeticDayTotals(fixture("2026-09-10"));
		const secondDay = fixture("2026-09-11");
		secondDay.buckets.pvKwh = [1, 0, 0, null];
		secondDay.buckets.gridExportKwh = [0, 0, 0, null];
		const second = buildEnergeticDayTotals(secondDay);
		const period = sumEnergeticDays([first, second, null], {
			period: "last_7_days",
			periodLabelDe: "Letzte 7 Tage",
			fromKey: "2026-09-05",
			toKey: "2026-09-11",
		});
		assert.equal(period.daysTotal, 3);
		assert.equal(period.daysWithTelemetry, 2);
		assert.equal(period.selfConsumptionKwh, 3.25);
		assert.equal(period.selfConsumptionPct, 81.3);
		assert.equal(period.evFastChargedKwh, 0.8);
		assert.equal(period.evFastBatteryKwh, 0.08);
		assert.equal(period.evFastGridKwh, 0.4);
		assert.equal(period.evFastLocalKwh, 0.32);
		assert.equal(period.nonMonetized.pelletReliefKwh, null);
		assert.equal(period.nonMonetized.avoidedBoilerStarts, null);
		assert.equal(period.nonMonetized.wearValueEur, null);
	});

	it("weist den Perioden-Schnellanteil bei einem Ladetag ohne Modusspur nicht teilweise aus", () => {
		const complete = buildEnergeticDayTotals(fixture("2026-09-10"));
		const missingMode = fixture("2026-09-11");
		missingMode.buckets.evFastChargedKwh![1] = null;
		const period = sumEnergeticDays([complete, buildEnergeticDayTotals(missingMode)], {
			period: "last_7_days",
			periodLabelDe: "Letzte 7 Tage",
			fromKey: "2026-09-05",
			toKey: "2026-09-11",
		});
		assert.equal(period.evFastChargedKwh, null);
		assert.equal(period.evFastGridKwh, null);
		assert.match(period.notesDe.join(" "), /Modusspur/);
	});
});

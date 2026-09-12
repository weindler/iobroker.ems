import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDayRecord, type DayTelemetryDayRecord } from "../day_telemetry/types";
import { SHADOW_ENGINE_MODEL_VERSION } from "./constants";
import { buildShadowDayRecord } from "./run";

function day(
	dateKey: string,
	soc: number[],
	loadKwh = 1,
	pvKwh = 0,
): DayTelemetryDayRecord {
	const out = emptyDayRecord(dateKey, "Europe/Berlin", 0, soc.length * 15 * 60_000, soc.length);
	out.complete = true;
	out.evaluable = true;
	out.buckets.pvKwh = soc.map(() => pvKwh);
	out.buckets.houseTotalKwh = soc.map(() => loadKwh);
	out.buckets.gridImportKwh = soc.map(() => 0);
	out.buckets.gridExportKwh = soc.map(() => 0);
	out.buckets.batteryChargedKwh = soc.map(() => 0);
	out.buckets.batteryDischargedKwh = soc.map(() => 0);
	out.buckets.batterySocEndPct = soc;
	out.buckets.priceCtPerKwh = soc.map(() => 30);
	return out;
}

const BATTERY = {
	usableCapacityKwh: 10,
	minSocPct: 10,
	maxSocPct: 100,
	maxChargeW: null,
	maxDischargeW: null,
};

describe("Shadow reference_no_ems über Tagesgrenzen", () => {
	it("führt den kontrafaktischen End-SOC als Start-SOC des Folgetags fort", () => {
		const previousReal = day("2026-08-28", [85, 80], 0, 0);
		const firstDay = day("2026-08-29", [80, 76, 73, 70]);
		const first = buildShadowDayRecord(
			"2026-08-29",
			firstDay,
			previousReal,
			BATTERY,
			8,
			false,
			"2026-08-31T00:00:00.000Z",
		);
		const firstNoEms = first.strategies.reference_no_ems!;
		assert.equal(firstNoEms.socStartPct, 80);
		assert.equal(firstNoEms.socStartSource, "previous_real");
		assert.equal(firstNoEms.socContinuousFromPreviousDay, false);
		assert.notEqual(firstNoEms.socEndPct, first.real.socEndPct);

		const secondDay = day("2026-08-30", [70, 68, 65, 63]);
		const second = buildShadowDayRecord(
			"2026-08-30",
			secondDay,
			firstDay,
			BATTERY,
			8,
			false,
			"2026-08-31T00:00:00.000Z",
			null,
			{
				dateKey: first.dateKey,
				socEndPct: firstNoEms.socEndPct,
				modelVersion: firstNoEms.modelVersion,
			},
		);

		assert.equal(second.strategies.reference_no_ems!.socStartPct, firstNoEms.socEndPct);
		assert.equal(second.strategies.reference_no_ems!.socStartSource, "previous_shadow");
		assert.equal(second.strategies.reference_no_ems!.socContinuousFromPreviousDay, true);
	});

	it("verwirft eine alte Modellkette und fällt nachvollziehbar auf realen Vortags-SOC zurück", () => {
		const previous = day("2026-08-29", [75, 70]);
		const current = day("2026-08-30", [70, 65]);
		const record = buildShadowDayRecord(
			"2026-08-30",
			current,
			previous,
			BATTERY,
			8,
			false,
			"2026-08-31T00:00:00.000Z",
			null,
			{ dateKey: "2026-08-29", socEndPct: 25, modelVersion: "shadow_v3" },
		);
		assert.equal(record.strategies.reference_no_ems!.modelVersion, SHADOW_ENGINE_MODEL_VERSION);
		assert.equal(record.strategies.reference_no_ems!.socStartPct, 70);
		assert.equal(record.strategies.reference_no_ems!.socStartSource, "previous_real");
	});

	it("versioniert auch nicht bewertbare Tage, damit der Batch sie nicht endlos neu berechnet", () => {
		const record = buildShadowDayRecord(
			"2026-08-30",
			day("2026-08-30", [50]),
			null,
			{ ...BATTERY, usableCapacityKwh: null },
			8,
			false,
			"2026-08-31T00:00:00.000Z",
		);
		assert.equal(record.strategies.reference_no_ems!.evaluable, false);
		assert.equal(record.strategies.reference_no_ems!.modelVersion, SHADOW_ENGINE_MODEL_VERSION);
	});
});

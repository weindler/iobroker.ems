import assert from "node:assert/strict";
import { it } from "node:test";
import type { DayTelemetryDayRecord } from "../learning/day_telemetry/types";
import { measuredMobilityCost } from "./mobility_cost";

it("bewertet jede gemessene Ladung mit ihrem eigenen Tibber-Preis statt Monatsdurchschnitt", () => {
	const day = { dateKey: "2026-09-25", startMs: Date.parse("2026-09-24T22:00:00Z"),
		slotWidthMs: 900_000, slotCount: 2, buckets: {
		evChargedKwh: [4, 6], houseTotalKwh: [8, 6], pvKwh: [8, 0],
		gridExportKwh: [0, 0], priceCtPerKwh: [15, 40],
	} } as DayTelemetryDayRecord;
	const result = measuredMobilityCost(day, 9.3);
	assert.equal(result?.chargedKwh, 10);
	assert.equal(result?.pvKwh, 4);
	assert.equal(result?.otherKwh, 6);
	assert.equal(result?.costEur, 2.77);
	assert.equal(result?.runs.length, 1);
	assert.equal(result?.runs[0]?.chargeDurationMin, 30);
	day.buckets.priceCtPerKwh[1] = null;
	assert.equal(measuredMobilityCost(day, 9.3), null);
});

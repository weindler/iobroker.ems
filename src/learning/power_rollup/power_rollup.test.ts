import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bufferToHourRecord, emptyHourBuffer, ingestPowerSample } from "./buffer";
import { localHourKey } from "./hour";
import { rollupSourceToPowerPoints } from "./rollup_points";
import type { PowerSourcePersist } from "./types";

describe("power rollup", () => {
	it("tracks max charge and discharge per hour", () => {
		const base = Date.parse("2026-06-30T14:05:00");
		let buf = emptyHourBuffer(localHourKey(base));
		buf = ingestPowerSample(buf, base + 60_000, -2500, true);
		buf = ingestPowerSample(buf, base + 120_000, -1800, true);
		buf = ingestPowerSample(buf, base + 300_000, -1200, true);
		buf = ingestPowerSample(buf, base + 900_000, 80, true);

		const rec = bufferToHourRecord(buf);
		assert.ok(rec);
		assert.equal(rec.maxDischargeW, 80);
		assert.equal(rec.maxChargeW, 2500);
		assert.equal(rec.chargeSamples, 3);
		assert.equal(rec.dischargeSamples, 1);
	});

	it("exports hourly peaks as power points", () => {
		const hourKey = "2026-06-30T14";
		const source: PowerSourcePersist = {
			sourceKey: "battery.power_w",
			stateId: "alias.0.Sonnen.Status.pacTotal",
			powerInvert: true,
			backfillDone: true,
			hours: {
				[hourKey]: {
					hourKey,
					sampleCount: 4,
					chargeSamples: 1,
					dischargeSamples: 3,
					maxChargeW: 1800,
					maxDischargeW: 2500,
					lastSampleTs: Date.parse("2026-06-30T14:55:00"),
				},
			},
		};

		const { points, meta } = rollupSourceToPowerPoints(
			source,
			90,
			Date.parse("2026-07-01T00:00:00"),
		);
		assert.equal(points.length, 2);
		assert.equal(points[0].powerW, 1800);
		assert.equal(points[1].powerW, -2500);
		assert.equal(meta.hourlyChargePoints, 1);
		assert.equal(meta.hourlyDischargePoints, 1);
		assert.equal(meta.powerHistoryMode, "ems_rollup");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	bufferToHourRecord,
	emptyHourBuffer,
	ingestBidirectionalSample,
	ingestUnidirectionalAvgSample,
} from "./buffer";
import { localHourKey } from "./hour";
import { rollupSourceToHouseLoadSamples, rollupSourceToPowerPoints } from "./rollup_points";
import type { PowerSourcePersist } from "./types";

describe("power rollup", () => {
	it("tracks max charge and discharge per hour (battery)", () => {
		const base = Date.parse("2026-06-30T14:05:00");
		let buf = emptyHourBuffer(localHourKey(base), "bidirectional_max");
		buf = ingestBidirectionalSample(buf, base + 60_000, -2500, true);
		buf = ingestBidirectionalSample(buf, base + 120_000, -1800, true);
		buf = ingestBidirectionalSample(buf, base + 300_000, -1200, true);
		buf = ingestBidirectionalSample(buf, base + 900_000, 80, true);

		const rec = bufferToHourRecord(buf);
		assert.ok(rec);
		assert.equal(rec.maxDischargeW, 80);
		assert.equal(rec.maxChargeW, 2500);
		assert.equal(rec.chargeSamples, 3);
		assert.equal(rec.dischargeSamples, 1);
	});

	it("tracks hourly average for consumption", () => {
		const base = Date.parse("2026-06-30T10:00:00");
		let buf = emptyHourBuffer(localHourKey(base), "unidirectional_avg");
		buf = ingestUnidirectionalAvgSample(buf, base + 60_000, 1000, "W");
		buf = ingestUnidirectionalAvgSample(buf, base + 120_000, 2000, "W");

		const rec = bufferToHourRecord(buf);
		assert.ok(rec);
		assert.equal(rec.avgPowerW, 1500);
		assert.equal(rec.sampleCount, 2);
	});

	it("exports battery hourly peaks as power points", () => {
		const hourKey = "2026-06-30T14";
		const source: PowerSourcePersist = {
			sourceKey: "battery.power_w",
			stateId: "alias.0.Sonnen.Status.pacTotal",
			rollupMode: "bidirectional_max",
			powerInvert: true,
			powerUnit: "W",
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
		assert.equal(meta.powerHistoryMode, "ems_rollup");
	});

	it("exports consumption rollup as house load samples", () => {
		const hourKey = "2026-06-30T14";
		const source: PowerSourcePersist = {
			sourceKey: "battery.consumption_w",
			stateId: "alias.0.Sonnen.Status.consumption",
			rollupMode: "unidirectional_avg",
			powerInvert: false,
			powerUnit: "W",
			backfillDone: true,
			hours: {
				[hourKey]: {
					hourKey,
					sampleCount: 12,
					lastSampleTs: Date.parse("2026-06-30T14:55:00"),
					chargeSamples: 0,
					dischargeSamples: 0,
					maxChargeW: null,
					maxDischargeW: null,
					sumPowerW: 18000,
					avgPowerW: 1500,
				},
			},
		};

		const { samples, stats } = rollupSourceToHouseLoadSamples(
			source,
			90,
			Date.parse("2026-07-01T00:00:00"),
		);
		assert.equal(samples.length, 1);
		assert.equal(samples[0].powerW, 1500);
		assert.equal(stats.historySource, "ems_rollup");
	});
});

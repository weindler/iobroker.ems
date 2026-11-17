import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	bufferToDayRecord,
	emptyDayBuffer,
	ingestDailyKwhSample,
} from "./buffer";
import { localDateKey } from "./day";
import { isStaleDailyCounter } from "./index";
import { mergeDayRecord } from "./persist";

describe("energy daily rollup", () => {
	it("keeps latest sample per calendar day", () => {
		const base = Date.parse("2026-07-02T10:00:00");
		let buf = emptyDayBuffer(localDateKey(new Date(base)));
		buf = ingestDailyKwhSample(buf, base + 5_000, 5.2);
		buf = ingestDailyKwhSample(buf, base + 10_000, 5.8);
		buf = ingestDailyKwhSample(buf, base + 15_000, 5.5);

		const rec = bufferToDayRecord(buf);
		assert.ok(rec);
		assert.equal(rec.kwh, 5.5);
		assert.equal(rec.sampleCount, 3);
	});

	it("merges backfill and live by latest timestamp", () => {
		const merged = mergeDayRecord(
			{
				dateKey: "2026-07-01",
				kwh: 12.1,
				lastSampleTs: Date.parse("2026-07-01T20:00:00"),
				sampleCount: 1,
			},
			{
				dateKey: "2026-07-01",
				kwh: 12.4,
				lastSampleTs: Date.parse("2026-07-01T22:00:00"),
				sampleCount: 5,
			},
		);
		assert.equal(merged.kwh, 12.4);
		assert.equal(merged.sampleCount, 6);
	});
});

describe("Tageszähler vom Vortag", () => {
	it("Wert von gestern gilt nicht als heute", () => {
		const now = new Date(2026, 10, 17, 6, 53).getTime();
		assert.equal(isStaleDailyCounter(new Date(2026, 10, 16, 16, 40).getTime(), now), true);
		assert.equal(isStaleDailyCounter(new Date(2026, 10, 17, 0, 5).getTime(), now), false);
		assert.equal(isStaleDailyCounter(null, now), false);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDailyPersist, upsertDailyRecord } from "./daily_persist";
import { actualSnapshotCapturedForDate, shouldCaptureActualSnapshot } from "./snapshot";

describe("pv_bias snapshot", () => {
	it("captures after snapshot time when not yet stored today", () => {
		const now = new Date(2026, 5, 30, 23, 59, 0);
		assert.equal(shouldCaptureActualSnapshot(now, "23:58", false), true);
	});

	it("skips capture before snapshot time", () => {
		const now = new Date(2026, 5, 30, 22, 0, 0);
		assert.equal(shouldCaptureActualSnapshot(now, "23:58", false), false);
	});

	it("skips when today already captured", () => {
		const now = new Date(2026, 5, 30, 23, 59, 0);
		assert.equal(shouldCaptureActualSnapshot(now, "23:58", true), false);
	});

	it("detects captured date in persist", () => {
		let persist = emptyDailyPersist();
		persist = upsertDailyRecord(persist, {
			date: "2026-06-30",
			actualKwh: 31.9,
			actualCapturedAt: "2026-06-30T21:58:00.000Z",
			forecastKwh: 13.2,
			forecastCapturedAt: "2026-06-30T04:00:00.000Z",
		});
		assert.equal(actualSnapshotCapturedForDate(persist, "2026-06-30"), true);
		assert.equal(actualSnapshotCapturedForDate(persist, "2026-07-01"), false);
	});
});

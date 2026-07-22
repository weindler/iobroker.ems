import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
	isoAtTimezoneLocal,
	localDateKeyInTimezone,
	resetZonedFormatterCacheForTest,
	zonedFormatterCacheHasForTest,
	zonedFormatterCacheSizeForTest,
} from "./time.js";

describe("operator time formatter cache", () => {
	beforeEach(() => {
		resetZonedFormatterCacheForTest();
	});

	it("reuses one formatter per timezone across many slot scans", () => {
		assert.equal(zonedFormatterCacheSizeForTest(), 0);
		for (let i = 0; i < 50; i++) {
			isoAtTimezoneLocal("2026-07-15", 12, 0, "Europe/Berlin");
			isoAtTimezoneLocal("2026-07-15", 12, 15, "Europe/Berlin");
			isoAtTimezoneLocal("2026-07-15", 0, 0, "Europe/Berlin");
		}
		assert.equal(zonedFormatterCacheSizeForTest(), 1);
		assert.equal(zonedFormatterCacheHasForTest("Europe/Berlin"), true);
	});

	it("keeps distinct formatters for distinct valid timezones", () => {
		isoAtTimezoneLocal("2026-07-15", 12, 0, "Europe/Berlin");
		isoAtTimezoneLocal("2026-07-15", 12, 0, "America/New_York");
		isoAtTimezoneLocal("2026-07-15", 12, 0, "UTC");
		assert.equal(zonedFormatterCacheSizeForTest(), 3);
		assert.equal(zonedFormatterCacheHasForTest("Europe/Berlin"), true);
		assert.equal(zonedFormatterCacheHasForTest("America/New_York"), true);
		assert.equal(zonedFormatterCacheHasForTest("UTC"), true);
	});

	it("does not cache invalid timezones and still returns a usable ISO", () => {
		const before = zonedFormatterCacheSizeForTest();
		const iso = isoAtTimezoneLocal("2026-07-15", 12, 0, "Not/A_Real_Zone");
		assert.ok(isValidIso(iso));
		assert.equal(zonedFormatterCacheHasForTest("Not/A_Real_Zone"), false);
		// May add UTC fallback to cache, but never the invalid key.
		assert.ok(zonedFormatterCacheSizeForTest() <= before + 1);
		assert.equal(zonedFormatterCacheHasForTest("UTC"), true);
	});

	it("preserves Europe/Berlin slot boundaries including DST offsets", () => {
		// Non-midnight hours work with hour12:false; values must stay stable with the cache.
		assert.equal(isoAtTimezoneLocal("2026-07-15", 12, 15, "Europe/Berlin"), "2026-07-15T10:15:00.000Z"); // CEST
		assert.equal(isoAtTimezoneLocal("2026-01-15", 12, 15, "Europe/Berlin"), "2026-01-15T11:15:00.000Z"); // CET
		// Local midnight: current ICU reports hour=00 (not the historical hour=24 fallback),
		// so the scan finds the real zoned minute — this must be the true CEST/CET midnight.
		assert.equal(isoAtTimezoneLocal("2026-07-15", 0, 0, "Europe/Berlin"), "2026-07-14T22:00:00.000Z"); // CEST (UTC+2)
		assert.equal(isoAtTimezoneLocal("2026-01-15", 0, 0, "Europe/Berlin"), "2026-01-14T23:00:00.000Z"); // CET (UTC+1)
		assert.equal(zonedFormatterCacheSizeForTest(), 1);
	});

	it("repeated conversions stay bit-identical with the cached formatter", () => {
		const samples: Array<[string, number, number]> = [
			["2026-03-29", 2, 0], // DST spring vicinity
			["2026-10-25", 2, 30], // DST autumn vicinity
			["2026-07-15", 12, 0],
			["2026-07-15", 12, 15],
			["2026-07-15", 0, 0],
		];
		const first = samples.map(([d, h, m]) => isoAtTimezoneLocal(d, h, m, "Europe/Berlin"));
		const second = samples.map(([d, h, m]) => isoAtTimezoneLocal(d, h, m, "Europe/Berlin"));
		assert.deepEqual(second, first);
	});

	it("localDateKeyInTimezone stays stable across repeated formatter reuse", () => {
		const d = new Date("2026-07-15T10:15:00.000Z");
		const a = localDateKeyInTimezone(d, "Europe/Berlin");
		const b = localDateKeyInTimezone(d, "Europe/Berlin");
		assert.equal(a, "2026-07-15");
		assert.equal(b, "2026-07-15");
		assert.equal(zonedFormatterCacheSizeForTest(), 1);
	});
});

function isValidIso(iso: string): boolean {
	return Number.isFinite(Date.parse(iso));
}

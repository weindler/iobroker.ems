"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const time_js_1 = require("./time.js");
(0, node_test_1.describe)("operator time formatter cache", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, time_js_1.resetZonedFormatterCacheForTest)();
    });
    (0, node_test_1.it)("reuses one formatter per timezone across many slot scans", () => {
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheSizeForTest)(), 0);
        for (let i = 0; i < 50; i++) {
            (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 0, "Europe/Berlin");
            (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 15, "Europe/Berlin");
            (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 0, 0, "Europe/Berlin");
        }
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheSizeForTest)(), 1);
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("Europe/Berlin"), true);
    });
    (0, node_test_1.it)("keeps distinct formatters for distinct valid timezones", () => {
        (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 0, "Europe/Berlin");
        (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 0, "America/New_York");
        (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 0, "UTC");
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheSizeForTest)(), 3);
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("Europe/Berlin"), true);
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("America/New_York"), true);
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("UTC"), true);
    });
    (0, node_test_1.it)("does not cache invalid timezones and still returns a usable ISO", () => {
        const before = (0, time_js_1.zonedFormatterCacheSizeForTest)();
        const iso = (0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 0, "Not/A_Real_Zone");
        strict_1.default.ok(isValidIso(iso));
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("Not/A_Real_Zone"), false);
        // May add UTC fallback to cache, but never the invalid key.
        strict_1.default.ok((0, time_js_1.zonedFormatterCacheSizeForTest)() <= before + 1);
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheHasForTest)("UTC"), true);
    });
    (0, node_test_1.it)("preserves Europe/Berlin slot boundaries including DST offsets", () => {
        // Non-midnight hours work with hour12:false; values must stay stable with the cache.
        strict_1.default.equal((0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 12, 15, "Europe/Berlin"), "2026-07-15T10:15:00.000Z"); // CEST
        strict_1.default.equal((0, time_js_1.isoAtTimezoneLocal)("2026-01-15", 12, 15, "Europe/Berlin"), "2026-01-15T11:15:00.000Z"); // CET
        // Local midnight: current ICU reports hour=00 (not the historical hour=24 fallback),
        // so the scan finds the real zoned minute — this must be the true CEST/CET midnight.
        strict_1.default.equal((0, time_js_1.isoAtTimezoneLocal)("2026-07-15", 0, 0, "Europe/Berlin"), "2026-07-14T22:00:00.000Z"); // CEST (UTC+2)
        strict_1.default.equal((0, time_js_1.isoAtTimezoneLocal)("2026-01-15", 0, 0, "Europe/Berlin"), "2026-01-14T23:00:00.000Z"); // CET (UTC+1)
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheSizeForTest)(), 1);
    });
    (0, node_test_1.it)("repeated conversions stay bit-identical with the cached formatter", () => {
        const samples = [
            ["2026-03-29", 2, 0], // DST spring vicinity
            ["2026-10-25", 2, 30], // DST autumn vicinity
            ["2026-07-15", 12, 0],
            ["2026-07-15", 12, 15],
            ["2026-07-15", 0, 0],
        ];
        const first = samples.map(([d, h, m]) => (0, time_js_1.isoAtTimezoneLocal)(d, h, m, "Europe/Berlin"));
        const second = samples.map(([d, h, m]) => (0, time_js_1.isoAtTimezoneLocal)(d, h, m, "Europe/Berlin"));
        strict_1.default.deepEqual(second, first);
    });
    (0, node_test_1.it)("localDateKeyInTimezone stays stable across repeated formatter reuse", () => {
        const d = new Date("2026-07-15T10:15:00.000Z");
        const a = (0, time_js_1.localDateKeyInTimezone)(d, "Europe/Berlin");
        const b = (0, time_js_1.localDateKeyInTimezone)(d, "Europe/Berlin");
        strict_1.default.equal(a, "2026-07-15");
        strict_1.default.equal(b, "2026-07-15");
        strict_1.default.equal((0, time_js_1.zonedFormatterCacheSizeForTest)(), 1);
    });
});
function isValidIso(iso) {
    return Number.isFinite(Date.parse(iso));
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
const time_1 = require("./time");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
/** Lokale Kalenderzeit — ohne ISO/UTC-Roundtrip (Tests stabil über Zeitzonen). */
function sampleLocal(year, month, day, hour, powerW) {
    const d = new Date(year, month - 1, day, hour, 0, 0, 0);
    const ctx = (0, time_1.calendarContext)(d);
    return {
        ts: d.getTime(),
        hourStartMs: d.getTime(),
        dateKey: ctx.dateKey,
        hourOfDay: hour,
        segment: ctx.segment,
        season: ctx.season,
        weekday: ctx.weekday,
        dayType: ctx.dayType,
        powerW,
    };
}
/** Mehrere Samples am gleichen Wochentag, wöchentlich zurück. */
function manyWeeklySamples(year, month, day, hour, powerW, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(year, month - 1, day, hour, 0, 0, 0);
        d.setDate(d.getDate() - 7 * i);
        out.push(sampleLocal(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, powerW));
    }
    return out;
}
(0, node_test_1.describe)("house load time", () => {
    (0, node_test_1.it)("detects season from month", () => {
        strict_1.default.equal((0, time_1.seasonFromDate)(new Date("2026-07-15T12:00:00")), "summer");
        strict_1.default.equal((0, time_1.seasonFromDate)(new Date("2026-01-15T12:00:00")), "winter");
        strict_1.default.equal((0, time_1.seasonFromDate)(new Date("2026-04-10T12:00:00")), "spring");
        strict_1.default.equal((0, time_1.seasonFromDate)(new Date("2026-10-10T12:00:00")), "autumn");
    });
    (0, node_test_1.it)("detects weekday and weekend", () => {
        strict_1.default.equal((0, time_1.weekdayFromDate)(new Date("2026-06-15T12:00:00")), "monday");
        strict_1.default.equal((0, time_1.dayTypeFromWeekday)("saturday"), "weekend");
        strict_1.default.equal((0, time_1.dayTypeFromWeekday)("tuesday"), "weekday");
    });
    (0, node_test_1.it)("maps hours to segments", () => {
        strict_1.default.equal((0, time_1.segmentFromHour)(2), "night");
        strict_1.default.equal((0, time_1.segmentFromHour)(8), "morning");
        strict_1.default.equal((0, time_1.segmentFromHour)(12), "midday");
        strict_1.default.equal((0, time_1.segmentFromHour)(16), "afternoon");
        strict_1.default.equal((0, time_1.segmentFromHour)(20), "evening");
    });
});
(0, node_test_1.describe)("house load validation", () => {
    (0, node_test_1.it)("ignores null and negative values", () => {
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(null), false);
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(-100), false);
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(500), true);
    });
});
(0, node_test_1.describe)("house load profile and fallback", () => {
    (0, node_test_1.it)("uses season+weekday+segment when enough samples", () => {
        const samples = manyWeeklySamples(2026, 7, 6, 8, 400, 5);
        const acc = (0, math_1.buildProfileAccumulators)(samples);
        const lookup = (0, math_1.lookupSegmentProfile)(acc, "summer", "monday", "weekday", "morning");
        strict_1.default.equal(lookup.fallbackLevel, "season_weekday_segment");
        strict_1.default.equal(lookup.avgW, 400);
    });
    (0, node_test_1.it)("falls back to season+day_type when weekday sparse", () => {
        const samples = [
            ...manyWeeklySamples(2026, 7, 7, 8, 300, 4),
            ...manyWeeklySamples(2026, 7, 8, 8, 500, 4),
        ];
        const acc = (0, math_1.buildProfileAccumulators)(samples);
        const lookup = (0, math_1.lookupSegmentProfile)(acc, "summer", "monday", "weekday", "morning");
        strict_1.default.equal(lookup.fallbackLevel, "season_day_type_segment");
        strict_1.default.ok(lookup.avgW !== null && lookup.avgW > 300);
    });
    (0, node_test_1.it)("falls back to global segment when needed", () => {
        const samples = manyWeeklySamples(2026, 7, 15, 14, 250, 5);
        const acc = (0, math_1.buildProfileAccumulators)(samples);
        const lookup = (0, math_1.lookupSegmentProfile)(acc, "winter", "friday", "weekday", "afternoon");
        strict_1.default.equal(lookup.fallbackLevel, "global_segment");
        strict_1.default.equal(lookup.avgW, 250);
    });
});
(0, node_test_1.describe)("house load forecast", () => {
    (0, node_test_1.it)("builds today and tomorrow segment forecasts", () => {
        const samples = manyWeeklySamples(2026, 6, 1, 11, 350, 6);
        const acc = (0, math_1.buildProfileAccumulators)(samples);
        const today = (0, math_1.buildDayForecast)(acc, 0);
        const tomorrow = (0, math_1.buildDayForecast)(acc, 1);
        strict_1.default.ok(today.segments.midday?.avg_w !== undefined);
        strict_1.default.ok(tomorrow.date !== today.date);
    });
    (0, node_test_1.it)("no_source health", () => {
        const r = (0, math_1.noSourceResult)("", new Date("2026-06-21T10:00:00"));
        strict_1.default.equal(r.status, "no_source");
        strict_1.default.equal(r.healthJson.status, "no_source");
        strict_1.default.equal(r.healthJson.missing_source, true);
    });
});
(0, node_test_1.describe)("house load compute", () => {
    (0, node_test_1.it)("returns insufficient_data with few samples", () => {
        const samples = [sampleLocal(2026, 6, 20, 8, 400)];
        const r = (0, math_1.computeHouseLoadLearning)({
            samples,
            sampleDays: 1,
            lastValidTs: samples[0].ts,
            sourceStateId: "sonnen.0.status.consumption",
            now: new Date("2026-06-21T10:00:00"),
            lastPersistAt: null,
        });
        strict_1.default.equal(r.status, "insufficient_data");
        strict_1.default.equal(r.sampleCount, 1);
    });
    (0, node_test_1.it)("profile json has season structure", () => {
        const samples = manyWeeklySamples(2026, 7, 6, 8, 420, 5);
        const acc = (0, math_1.buildProfileAccumulators)(samples);
        const profile = (0, math_1.accumulatorsToProfileJson)(acc);
        strict_1.default.ok(profile.summer?.monday?.morning);
        strict_1.default.equal(profile.summer?.monday?.morning?.avgW, 420);
        strict_1.default.equal((0, math_1.cellConfidence)(20), 1);
    });
    (0, node_test_1.it)("returns degraded health with sparse data", () => {
        const samples = manyWeeklySamples(2026, 6, 1, 11, 350, 2);
        const r = (0, math_1.computeHouseLoadLearning)({
            samples,
            sampleDays: 2,
            lastValidTs: samples[0]?.ts ?? null,
            sourceStateId: "sonnen.0.status.consumption",
            now: new Date("2026-06-21T10:00:00"),
            lastPersistAt: null,
        });
        strict_1.default.equal(r.status, "insufficient_data");
        strict_1.default.equal(r.healthJson.status, "degraded");
    });
});
(0, node_test_1.describe)("house load persist", () => {
    (0, node_test_1.it)("roundtrips persist file", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hl-"));
        const samples = manyWeeklySamples(2026, 7, 6, 8, 420, 5);
        const result = (0, math_1.computeHouseLoadLearning)({
            samples,
            sampleDays: 5,
            lastValidTs: Date.now(),
            sourceStateId: "sonnen.0.status.consumption",
            now: new Date("2026-07-06T09:00:00"),
            lastPersistAt: null,
        });
        await (0, persist_1.writeHouseLoadPersist)(dir, result, "2026-07-06T10:00:00.000Z");
        const read = await (0, persist_1.readHouseLoadPersist)(dir);
        strict_1.default.ok(read);
        strict_1.default.equal(read?.module, "house_load_learning_v1");
        strict_1.default.equal(read?.sample_count, result.sampleCount);
        strict_1.default.ok(read?.profile.summer);
    });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidHouseLoadW } from "./history";
import {
	accumulatorsToProfileJson,
	buildDayForecast,
	buildProfileAccumulators,
	cellConfidence,
	computeHouseLoadLearning,
	lookupSegmentProfile,
	noSourceResult,
} from "./math";
import { readHouseLoadPersist, writeHouseLoadPersist } from "./persist";
import {
	calendarContext,
	dayTypeFromWeekday,
	seasonFromDate,
	segmentFromHour,
	weekdayFromDate,
} from "./time";
import type { HouseLoadSample } from "./types";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** Lokale Kalenderzeit — ohne ISO/UTC-Roundtrip (Tests stabil über Zeitzonen). */
function sampleLocal(year: number, month: number, day: number, hour: number, powerW: number): HouseLoadSample {
	const d = new Date(year, month - 1, day, hour, 0, 0, 0);
	const ctx = calendarContext(d);
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
function manyWeeklySamples(
	year: number,
	month: number,
	day: number,
	hour: number,
	powerW: number,
	count: number,
): HouseLoadSample[] {
	const out: HouseLoadSample[] = [];
	for (let i = 0; i < count; i++) {
		const d = new Date(year, month - 1, day, hour, 0, 0, 0);
		d.setDate(d.getDate() - 7 * i);
		out.push(sampleLocal(d.getFullYear(), d.getMonth() + 1, d.getDate(), hour, powerW));
	}
	return out;
}

describe("house load time", () => {
	it("detects season from month", () => {
		assert.equal(seasonFromDate(new Date("2026-07-15T12:00:00")), "summer");
		assert.equal(seasonFromDate(new Date("2026-01-15T12:00:00")), "winter");
		assert.equal(seasonFromDate(new Date("2026-04-10T12:00:00")), "spring");
		assert.equal(seasonFromDate(new Date("2026-10-10T12:00:00")), "autumn");
	});

	it("detects weekday and weekend", () => {
		assert.equal(weekdayFromDate(new Date("2026-06-15T12:00:00")), "monday");
		assert.equal(dayTypeFromWeekday("saturday"), "weekend");
		assert.equal(dayTypeFromWeekday("tuesday"), "weekday");
	});

	it("maps hours to segments", () => {
		assert.equal(segmentFromHour(2), "night");
		assert.equal(segmentFromHour(8), "morning");
		assert.equal(segmentFromHour(12), "midday");
		assert.equal(segmentFromHour(16), "afternoon");
		assert.equal(segmentFromHour(20), "evening");
	});
});

describe("house load validation", () => {
	it("ignores null and negative values", () => {
		assert.equal(isValidHouseLoadW(null), false);
		assert.equal(isValidHouseLoadW(-100), false);
		assert.equal(isValidHouseLoadW(500), true);
	});
});

describe("house load profile and fallback", () => {
	it("uses season+weekday+segment when enough samples", () => {
		const samples = manyWeeklySamples(2026, 7, 6, 8, 400, 5);
		const acc = buildProfileAccumulators(samples);
		const lookup = lookupSegmentProfile(acc, "summer", "monday", "weekday", "morning");
		assert.equal(lookup.fallbackLevel, "season_weekday_segment");
		assert.equal(lookup.avgW, 400);
	});

	it("falls back to season+day_type when weekday sparse", () => {
		const samples = [
			...manyWeeklySamples(2026, 7, 7, 8, 300, 4),
			...manyWeeklySamples(2026, 7, 8, 8, 500, 4),
		];
		const acc = buildProfileAccumulators(samples);
		const lookup = lookupSegmentProfile(acc, "summer", "monday", "weekday", "morning");
		assert.equal(lookup.fallbackLevel, "season_day_type_segment");
		assert.ok(lookup.avgW !== null && lookup.avgW > 300);
	});

	it("falls back to global segment when needed", () => {
		const samples = manyWeeklySamples(2026, 7, 15, 14, 250, 5);
		const acc = buildProfileAccumulators(samples);
		const lookup = lookupSegmentProfile(acc, "winter", "friday", "weekday", "afternoon");
		assert.equal(lookup.fallbackLevel, "global_segment");
		assert.equal(lookup.avgW, 250);
	});
});

describe("house load forecast", () => {
	it("builds today and tomorrow segment forecasts", () => {
		const samples = manyWeeklySamples(2026, 6, 1, 11, 350, 6);
		const acc = buildProfileAccumulators(samples);
		const today = buildDayForecast(acc, 0);
		const tomorrow = buildDayForecast(acc, 1);
		assert.ok(today.segments.midday?.avg_w !== undefined);
		assert.ok(tomorrow.date !== today.date);
	});

	it("no_source health", () => {
		const r = noSourceResult("", new Date("2026-06-21T10:00:00"));
		assert.equal(r.status, "no_source");
		assert.equal(r.healthJson.status, "no_source");
		assert.equal(r.healthJson.missing_source, true);
	});
});

describe("house load compute", () => {
	it("returns insufficient_data with few samples", () => {
		const samples = [sampleLocal(2026, 6, 20, 8, 400)];
		const r = computeHouseLoadLearning({
			samples,
			sampleDays: 1,
			lastValidTs: samples[0].ts,
			sourceStateId: "sonnen.0.status.consumption",
			now: new Date("2026-06-21T10:00:00"),
			lastPersistAt: null,
		});
		assert.equal(r.status, "insufficient_data");
		assert.equal(r.sampleCount, 1);
	});

	it("profile json has season structure", () => {
		const samples = manyWeeklySamples(2026, 7, 6, 8, 420, 5);
		const acc = buildProfileAccumulators(samples);
		const profile = accumulatorsToProfileJson(acc);
		assert.ok(profile.summer?.monday?.morning);
		assert.equal(profile.summer?.monday?.morning?.avgW, 420);
		assert.equal(cellConfidence(20), 1);
	});

	it("returns degraded health with sparse data", () => {
		const samples = manyWeeklySamples(2026, 6, 1, 11, 350, 2);
		const r = computeHouseLoadLearning({
			samples,
			sampleDays: 2,
			lastValidTs: samples[0]?.ts ?? null,
			sourceStateId: "sonnen.0.status.consumption",
			now: new Date("2026-06-21T10:00:00"),
			lastPersistAt: null,
		});
		assert.equal(r.status, "insufficient_data");
		assert.equal(r.healthJson.status, "degraded");
	});
});

describe("house load persist", () => {
	it("roundtrips persist file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hl-"));
		const samples = manyWeeklySamples(2026, 7, 6, 8, 420, 5);
		const result = computeHouseLoadLearning({
			samples,
			sampleDays: 5,
			lastValidTs: Date.now(),
			sourceStateId: "sonnen.0.status.consumption",
			now: new Date("2026-07-06T09:00:00"),
			lastPersistAt: null,
		});
		await writeHouseLoadPersist(dir, result, "2026-07-06T10:00:00.000Z");
		const read = await readHouseLoadPersist(dir);
		assert.ok(read);
		assert.equal(read?.module, "house_load_learning_v1");
		assert.equal(read?.sample_count, result.sampleCount);
		assert.ok(read?.profile.summer);
	});
});

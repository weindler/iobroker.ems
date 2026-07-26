import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DayForecastJson } from "../../learning/house_load/types";
import { buildHouseLoadContribution, dailyKwhFromHouseLoadDayForecast } from "./house_load";

function segmentForecast(): DayForecastJson {
	return {
		date: "2026-07-11",
		season: "summer",
		weekday: "saturday",
		day_type: "weekend",
		segments: {
			morning: { avg_w: 800, source: "profile", fallback_level: "none", confidence: 75 },
			midday: { avg_w: 600, source: "profile", fallback_level: "none", confidence: 75 },
		},
	};
}

describe("house load contribution", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");

	it("computes daily kWh from segments", () => {
		const kwh = dailyKwhFromHouseLoadDayForecast(segmentForecast());
		assert.equal(kwh, 5.6);
	});

	it("builds segment slots without 15-min subdivision", () => {
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "ready",
			confidence: 75,
			forecastToday: segmentForecast(),
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		});
		assert.equal(c.contributor.id, "house_load");
		assert.equal(c.contributor.type, "system");
		assert.deepEqual(c.roles, ["demand_fixed"]);
		assert.equal(c.slots.length, 2);
		assert.equal(c.slots[0].preferredPowerW, 800);
		assert.match(c.details.slotNoteDe as string, /Segment-Baseline/);
	});

	it("marks fallback level in degraded reason", () => {
		const forecast = segmentForecast();
		forecast.segments.morning!.fallback_level = "global_segment";
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "ready",
			confidence: 40,
			forecastToday: forecast,
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		});
		assert.equal(c.quality.status, "degraded");
		assert.match(c.reasonDe, /Fallback/);
	});

	it("does not invent null as zero for missing forecast", () => {
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "no_source",
			confidence: null,
			forecastToday: null,
			forecastTomorrow: null,
			lastUpdate: null,
		});
		assert.equal(c.enabled, false);
		assert.equal(c.details.expectedFixedTodayKwh, null);
	});

	it("exposes day 3-7 horizon kWh from forecastHorizon (pattern-based, no fabrication)", () => {
		const day3 = { ...segmentForecast(), date: "2026-07-13" };
		const day4 = { ...segmentForecast(), date: "2026-07-14" };
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "ready",
			confidence: 75,
			forecastToday: segmentForecast(),
			forecastTomorrow: null,
			forecastHorizon: [day3, day4],
			lastUpdate: now.toISOString(),
		});
		const horizonDays = c.details.horizonDays as Array<{ dayIndex: number; dateKey: string; kwh: number | null }>;
		assert.equal(horizonDays.length, 2);
		assert.equal(horizonDays[0].dayIndex, 2);
		assert.equal(horizonDays[0].dateKey, "2026-07-13");
		assert.equal(horizonDays[0].kwh, 5.6);
		assert.equal(horizonDays[1].dayIndex, 3);
		assert.equal(horizonDays[1].dateKey, "2026-07-14");
	});

	it("emits segment slots for forecastHorizon days (Block 5 ≥48h Daily Plan coverage)", () => {
		const day3 = { ...segmentForecast(), date: "2026-07-13" };
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "ready",
			confidence: 75,
			forecastToday: segmentForecast(),
			forecastTomorrow: null,
			forecastHorizon: [day3],
			lastUpdate: now.toISOString(),
		});
		assert.ok(c.slots.some((s) => s.slot.startIso.includes("2026-07-13")));
	});

	it("returns empty horizonDays when no forecastHorizon given (no fake days)", () => {
		const c = buildHouseLoadContribution({
			now,
			timezone: "Europe/Berlin",
			status: "ready",
			confidence: 75,
			forecastToday: segmentForecast(),
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		});
		assert.deepEqual(c.details.horizonDays, []);
	});
});

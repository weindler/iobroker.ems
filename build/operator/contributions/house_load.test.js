"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const house_load_1 = require("./house_load");
function segmentForecast() {
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
(0, node_test_1.describe)("house load contribution", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    (0, node_test_1.it)("computes daily kWh from segments", () => {
        const kwh = (0, house_load_1.dailyKwhFromHouseLoadDayForecast)(segmentForecast());
        strict_1.default.equal(kwh, 5.6);
    });
    (0, node_test_1.it)("builds segment slots without 15-min subdivision", () => {
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "ready",
            confidence: 75,
            forecastToday: segmentForecast(),
            forecastTomorrow: null,
            lastUpdate: now.toISOString(),
        });
        strict_1.default.equal(c.contributor.id, "house_load");
        strict_1.default.equal(c.contributor.type, "system");
        strict_1.default.deepEqual(c.roles, ["demand_fixed"]);
        strict_1.default.equal(c.slots.length, 2);
        strict_1.default.equal(c.slots[0].preferredPowerW, 800);
        strict_1.default.match(c.details.slotNoteDe, /Segment-Baseline/);
    });
    (0, node_test_1.it)("marks fallback level in degraded reason", () => {
        const forecast = segmentForecast();
        forecast.segments.morning.fallback_level = "global_segment";
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "ready",
            confidence: 40,
            forecastToday: forecast,
            forecastTomorrow: null,
            lastUpdate: now.toISOString(),
        });
        strict_1.default.equal(c.quality.status, "degraded");
        strict_1.default.match(c.reasonDe, /Fallback/);
    });
    (0, node_test_1.it)("does not invent null as zero for missing forecast", () => {
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "no_source",
            confidence: null,
            forecastToday: null,
            forecastTomorrow: null,
            lastUpdate: null,
        });
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.details.expectedFixedTodayKwh, null);
    });
    (0, node_test_1.it)("exposes day 3-7 horizon kWh from forecastHorizon (pattern-based, no fabrication)", () => {
        const day3 = { ...segmentForecast(), date: "2026-07-13" };
        const day4 = { ...segmentForecast(), date: "2026-07-14" };
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "ready",
            confidence: 75,
            forecastToday: segmentForecast(),
            forecastTomorrow: null,
            forecastHorizon: [day3, day4],
            lastUpdate: now.toISOString(),
        });
        const horizonDays = c.details.horizonDays;
        strict_1.default.equal(horizonDays.length, 2);
        strict_1.default.equal(horizonDays[0].dayIndex, 2);
        strict_1.default.equal(horizonDays[0].dateKey, "2026-07-13");
        strict_1.default.equal(horizonDays[0].kwh, 5.6);
        strict_1.default.equal(horizonDays[1].dayIndex, 3);
        strict_1.default.equal(horizonDays[1].dateKey, "2026-07-14");
    });
    (0, node_test_1.it)("emits segment slots for forecastHorizon days (Block 5 ≥48h Daily Plan coverage)", () => {
        const day3 = { ...segmentForecast(), date: "2026-07-13" };
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "ready",
            confidence: 75,
            forecastToday: segmentForecast(),
            forecastTomorrow: null,
            forecastHorizon: [day3],
            lastUpdate: now.toISOString(),
        });
        strict_1.default.ok(c.slots.some((s) => s.slot.startIso.includes("2026-07-13")));
    });
    (0, node_test_1.it)("returns empty horizonDays when no forecastHorizon given (no fake days)", () => {
        const c = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: "Europe/Berlin",
            status: "ready",
            confidence: 75,
            forecastToday: segmentForecast(),
            forecastTomorrow: null,
            lastUpdate: now.toISOString(),
        });
        strict_1.default.deepEqual(c.details.horizonDays, []);
    });
});

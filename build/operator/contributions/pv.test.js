"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pv_1 = require("./pv");
(0, node_test_1.describe)("pv contribution", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    (0, node_test_1.it)("builds valid forecast for today and tomorrow", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: 22.1,
            rawTodayKwh: 17,
            rawTomorrowKwh: 20,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [
                { dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 },
                { dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 22.1, confidencePct: 82 },
            ],
        });
        strict_1.default.equal(c.contributor.id, "pv_forecast");
        strict_1.default.equal(c.contributionId, "pv_forecast.supply");
        strict_1.default.equal(c.flow, "provide");
        strict_1.default.deepEqual(c.roles, ["supply"]);
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.quality.status, "valid");
        strict_1.default.equal(c.details.correctedTodayKwh, 18.5);
        strict_1.default.equal(c.slots.length, 0);
    });
    (0, node_test_1.it)("accepts genuine zero yield", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 0,
            correctedTomorrowKwh: null,
            rawTodayKwh: 0,
            rawTomorrowKwh: null,
            confidencePct: 70,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 0, confidencePct: 70 }],
        });
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.details.correctedTodayKwh, 0);
    });
    (0, node_test_1.it)("marks missing forecast as missing not zero", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: null,
            correctedTomorrowKwh: null,
            rawTodayKwh: null,
            rawTomorrowKwh: null,
            confidencePct: null,
            status: "no_config",
            lastUpdateTs: null,
            source: "learning.pv_bias",
            horizonDays: [],
        });
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.quality.status, "missing");
    });
    (0, node_test_1.it)("marks stale source as degraded", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 10,
            correctedTomorrowKwh: null,
            rawTodayKwh: 10,
            rawTomorrowKwh: null,
            confidencePct: 50,
            status: "ready",
            lastUpdateTs: "2026-07-01T10:00:00.000Z",
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 10, confidencePct: 50 }],
        });
        strict_1.default.equal(c.quality.status, "degraded");
    });
    (0, node_test_1.it)("stays daily_only without shape input (no invented per-slot power)", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: null,
            rawTodayKwh: 17,
            rawTomorrowKwh: null,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 }],
            shape: null,
        });
        strict_1.default.equal(c.slots.length, 0);
        strict_1.default.equal(c.details.slotResolution, "daily_only");
    });
    (0, node_test_1.it)("stays daily_only when shape input has no lat/lon", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: null,
            rawTodayKwh: 17,
            rawTomorrowKwh: null,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 }],
            shape: { timezone: "Europe/Berlin", latDeg: null, lonDeg: null, hourlyPoints: [], capW: null },
        });
        strict_1.default.equal(c.slots.length, 0);
        strict_1.default.equal(c.details.slotResolution, "daily_only");
    });
    (0, node_test_1.it)("builds a 15-min weather-shaped slot series for today and tomorrow when shape input is valid", () => {
        const c = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: 22.1,
            rawTodayKwh: 17,
            rawTomorrowKwh: 20,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [
                { dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 },
                { dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 22.1, confidencePct: 82 },
            ],
            shape: {
                timezone: "Europe/Berlin",
                latDeg: 48.14,
                lonDeg: 11.58,
                hourlyPoints: [],
                capW: null,
            },
        });
        strict_1.default.equal(c.details.slotResolution, "weather_shaped_15min");
        // 2 volle Kalendertage à 96 Slots
        strict_1.default.equal(c.slots.length, 192);
        const noonSlot = c.slots.find((s) => s.slot.startIso === "2026-07-11T10:00:00.000Z");
        const midnightSlot = c.slots.find((s) => s.slot.startIso === "2026-07-11T00:00:00.000Z");
        strict_1.default.ok((noonSlot?.preferredPowerW ?? 0) > 0);
        strict_1.default.equal(midnightSlot?.preferredPowerW, 0);
    });
    (0, node_test_1.it)("caps the shaped slots at the configured kWp ceiling", () => {
        const uncapped = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: null,
            rawTodayKwh: 17,
            rawTomorrowKwh: null,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 }],
            shape: { timezone: "Europe/Berlin", latDeg: 48.14, lonDeg: 11.58, hourlyPoints: [], capW: null },
        });
        const maxUncapped = Math.max(...uncapped.slots.map((s) => s.preferredPowerW ?? 0));
        const capW = Math.round(maxUncapped * 0.5);
        const capped = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 18.5,
            correctedTomorrowKwh: null,
            rawTodayKwh: 17,
            rawTomorrowKwh: null,
            confidencePct: 82,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 18.5, confidencePct: 82 }],
            shape: { timezone: "Europe/Berlin", latDeg: 48.14, lonDeg: 11.58, hourlyPoints: [], capW },
        });
        strict_1.default.ok(Math.max(...capped.slots.map((s) => s.preferredPowerW ?? 0)) <= capW);
    });
});

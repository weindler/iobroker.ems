"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const weather_1 = require("./weather");
(0, node_test_1.describe)("weather contribution", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    (0, node_test_1.it)("provides context without energy roles", () => {
        const c = (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: "ready",
            learningHealth: "ok",
            confidencePct: 88,
            lastUpdate: now.toISOString(),
            forecastSource: "brightsky",
            actualSource: "brightsky",
            outdoorTempC: 24.5,
            cloudPct: 30,
            hourlyPoints: [],
            todayMinTempC: 18,
            todayMaxTempC: 26,
            tomorrowMinTempC: null,
            tomorrowMaxTempC: null,
            forecastHorizonStart: now.toISOString(),
            forecastHorizonEnd: "2026-07-12T21:59:59.999Z",
        });
        strict_1.default.equal(c.contributor.id, "weather_forecast");
        strict_1.default.deepEqual(c.roles, ["context"]);
        strict_1.default.equal(c.details.contextOnly, true);
        strict_1.default.notDeepEqual(c.roles, ["supply"]);
    });
    (0, node_test_1.it)("allows missing partial values", () => {
        const c = (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: "ready",
            learningHealth: "ok",
            confidencePct: 50,
            lastUpdate: now.toISOString(),
            forecastSource: "brightsky",
            actualSource: null,
            outdoorTempC: 20,
            cloudPct: null,
            hourlyPoints: [],
            todayMinTempC: null,
            todayMaxTempC: 20,
            tomorrowMinTempC: null,
            tomorrowMaxTempC: null,
            forecastHorizonStart: now.toISOString(),
            forecastHorizonEnd: null,
        });
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.details.cloudPct, null);
    });
    (0, node_test_1.it)("marks missing weather as missing", () => {
        const c = (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: "not_initialized",
            learningHealth: "error",
            confidencePct: null,
            lastUpdate: null,
            forecastSource: null,
            actualSource: null,
            outdoorTempC: null,
            cloudPct: null,
            hourlyPoints: [],
            todayMinTempC: null,
            todayMaxTempC: null,
            tomorrowMinTempC: null,
            tomorrowMaxTempC: null,
            forecastHorizonStart: null,
            forecastHorizonEnd: null,
        });
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.quality.status, "missing");
    });
});

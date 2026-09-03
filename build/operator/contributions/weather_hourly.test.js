"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const weather_hourly_1 = require("./weather_hourly");
const read_1 = require("./read");
const math_1 = require("../../learning/weather/horizon/math");
function hourlyHost(states) {
    return {
        config: {
            pv_shape_enabled: true,
            pv_shape_brightsky_hourly_prefix: "brightsky.0.hourly",
            pv_shape_kwp_state_1: "pvforecast.0.plants.roofA.power.installed",
            pv_shape_kwp_state_2: "",
            intent_timezone: "Europe/Berlin",
        },
        getStateAsync: async (id) => {
            if (id in states)
                return { val: states[id] };
            if (id === "learning.pv_bias.corrected_today_kwh")
                return { val: 40 };
            if (id === "learning.pv_bias.status")
                return { val: "ready" };
            if (id === "learning.weather.status")
                return { val: "ready" };
            if (id === "learning.weather.health")
                return { val: "ok" };
            return null;
        },
        setObjectNotExistsAsync: async () => undefined,
        setStateAsync: async () => undefined,
        getForeignStateAsync: async (id) => {
            if (id in states)
                return { val: states[id] };
            if (id === "pvforecast.0.plants.roofA.power.installed")
                return { val: 5 };
            return null;
        },
        getForeignObjectAsync: async (id) => {
            if (id !== "system.config")
                return null;
            return { common: { latitude: 49.17, longitude: 12.48 } };
        },
    };
}
(0, node_test_1.describe)("weather hourly temperature forecast", () => {
    (0, node_test_1.it)("dayIndex: heute = 1, morgen = 2", () => {
        strict_1.default.equal((0, weather_hourly_1.weatherHourlyDayIndex)("2026-08-30", "2026-08-30"), 1);
        strict_1.default.equal((0, weather_hourly_1.weatherHourlyDayIndex)("2026-08-30", "2026-08-31"), 2);
    });
    (0, node_test_1.it)("vorhandene Stunden-Temperaturen landen in hourlyPoints, fehlende werden nicht erfunden", async () => {
        const now = new Date("2026-08-30T12:00:00.000Z");
        const host = hourlyHost({
            "brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
            "brightsky.0.hourly.00.temperature": 28.4,
            "brightsky.0.hourly.00.cloud_cover": 10,
            "brightsky.0.hourly.01.timestamp": "2026-08-30T11:00:00.000Z",
            "brightsky.0.hourly.01.temperature": 29.1,
            "brightsky.0.hourly.03.timestamp": "2026-08-30T13:00:00.000Z",
            /* 03: timestamp da, Temperatur fehlt → null, nicht interpoliert */
            "brightsky.0.hourly.02.cloud_cover": 50,
            /* 02: kein timestamp → Stunde existiert nicht */
        });
        const points = await (0, weather_hourly_1.collectWeatherHourlyPoints)(host, now, "Europe/Berlin", "brightsky.0.hourly");
        strict_1.default.equal(points.length, 3);
        strict_1.default.equal(points[0].outdoorTempC, 28.4);
        strict_1.default.equal(points[1].outdoorTempC, 29.1);
        strict_1.default.equal(points[2].outdoorTempC, null);
        strict_1.default.equal(points.some((p) => p.startIso === "2026-08-30T12:00:00.000Z"), false, "Stunde ohne timestamp darf nicht erfunden werden");
    });
    (0, node_test_1.it)("wendet vorhandenen Temp-Bias an, ohne fehlende Rohwerte zu erzeugen", async () => {
        const now = new Date("2026-08-30T12:00:00.000Z");
        const host = hourlyHost({
            "learning.weather.temp_bias_c": 2,
            "brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
            "brightsky.0.hourly.00.temperature": 20,
        });
        const points = await (0, weather_hourly_1.collectWeatherHourlyPoints)(host, now, "Europe/Berlin", "brightsky.0.hourly");
        strict_1.default.equal(points[0].outdoorTempC, (0, math_1.correctHorizonTempC)(20, 2, 1));
    });
    (0, node_test_1.it)("leerer Prefix liefert keine Punkte; Tages-Horizon bleibt unabhängig", async () => {
        const now = new Date("2026-08-30T12:00:00.000Z");
        const host = hourlyHost({
            "learning.weather.horizon.day1.min_temp_c": 14,
            "learning.weather.horizon.day1.max_temp_c": 28,
            "learning.weather.horizon.day1.quality": "valid",
        });
        const empty = await (0, weather_hourly_1.collectWeatherHourlyPoints)(host, now, "Europe/Berlin", "");
        strict_1.default.deepEqual(empty, []);
        const { contributions } = await (0, read_1.collectContributions)(host, now);
        const weather = contributions.find((c) => c.contributionId === "weather_forecast.context");
        const days = weather?.details.horizonDays;
        strict_1.default.equal(days?.find((d) => d.dayIndex === 1)?.maxTempC, 28);
    });
    (0, node_test_1.it)("collectContributions verdrahtet hourlyPoints in die Weather-Contribution", async () => {
        const now = new Date("2026-08-30T12:00:00.000Z");
        const host = hourlyHost({
            "brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
            "brightsky.0.hourly.00.temperature": 27.5,
            "learning.weather.horizon.day1.min_temp_c": 14,
            "learning.weather.horizon.day1.max_temp_c": 28,
            "learning.weather.horizon.day1.quality": "valid",
        });
        const { contributions } = await (0, read_1.collectContributions)(host, now);
        const weather = contributions.find((c) => c.contributionId === "weather_forecast.context");
        const hourly = weather?.details.hourlyPoints;
        strict_1.default.ok(hourly?.length);
        strict_1.default.equal(hourly[0].outdoorTempC, 27.5);
        const days = weather?.details.horizonDays;
        strict_1.default.equal(days?.find((d) => d.dayIndex === 1)?.maxTempC, 28);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const read_1 = require("./read");
const PV_SHAPE_CONFIG = {
    pv_shape_enabled: true,
    pv_shape_brightsky_hourly_prefix: "brightsky.0.hourly",
    pv_shape_kwp_state_1: "pvforecast.0.plants.roofA.power.installed",
    pv_shape_kwp_state_2: "",
    intent_timezone: "Europe/Berlin",
};
function buildHost(systemConfigCommon) {
    return {
        config: PV_SHAPE_CONFIG,
        getStateAsync: async (id) => {
            if (id === "learning.pv_bias.corrected_today_kwh")
                return { val: 45.6 };
            if (id === "learning.pv_bias.status")
                return { val: "ready" };
            return null;
        },
        setObjectNotExistsAsync: async () => undefined,
        setStateAsync: async () => undefined,
        getForeignStateAsync: async (id) => {
            if (id === "pvforecast.0.plants.roofA.power.installed")
                return { val: 5 };
            return null;
        },
        getForeignObjectAsync: async (id) => {
            if (id !== "system.config")
                return null;
            if (!systemConfigCommon)
                return null;
            return { common: systemConfigCommon };
        },
    };
}
(0, node_test_1.describe)("collectContributions — PV shape system location parsing", () => {
    const now = new Date("2026-07-25T12:40:00.000Z");
    (0, node_test_1.it)("activates the weather-shaped PV curve for numeric lat/lon", async () => {
        const host = buildHost({ latitude: 49.177197, longitude: 12.486605 });
        const { contributions } = await (0, read_1.collectContributions)(host, now);
        const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
        strict_1.default.equal(pv?.details.slotResolution, "weather_shaped_15min");
        strict_1.default.ok((pv?.slots.length ?? 0) > 0);
    });
    (0, node_test_1.it)("still activates when lat/lon are comma-decimal strings (e.g. Float-Teiler = Komma)", async () => {
        const host = buildHost({ latitude: "49,177197", longitude: "12,486605" });
        const { contributions } = await (0, read_1.collectContributions)(host, now);
        const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
        strict_1.default.equal(pv?.details.slotResolution, "weather_shaped_15min");
        strict_1.default.ok((pv?.slots.length ?? 0) > 0);
    });
    (0, node_test_1.it)("stays daily_only without a usable system location (fail-closed, no invented curve)", async () => {
        const host = buildHost(null);
        const { contributions } = await (0, read_1.collectContributions)(host, now);
        const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
        strict_1.default.equal(pv?.details.slotResolution, "daily_only");
        strict_1.default.equal(pv?.slots.length, 0);
    });
});

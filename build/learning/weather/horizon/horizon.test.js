"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
function mockHost(config, foreign = {}) {
    const objects = new Set();
    const states = new Map();
    return {
        objects,
        states,
        host: {
            config,
            setObjectNotExistsAsync: async (id) => {
                objects.add(id);
            },
            getStateAsync: async (id) => states.get(id) ?? null,
            getForeignStateAsync: async (id) => {
                if (!(id in foreign))
                    return null;
                const v = foreign[id];
                return v === null ? { val: null, ack: true, ts: 1, lc: 1, from: "t" } : { val: v, ack: true, ts: 1, lc: 1, from: "t" };
            },
            setStateAsync: async (id, st) => {
                states.set(id, { val: st.val, ack: st.ack === true });
            },
            log: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        },
    };
}
(0, node_test_1.describe)("weather horizon config", () => {
    (0, node_test_1.it)("parses day 3-7 mappings and defaults enabled", () => {
        const cfg = (0, index_js_1.weatherHorizonConfigFromAdapter)({
            learning_weather_horizon_day3_min_temp_state: "brightsky.0.daily.02.temperature_min",
            learning_weather_horizon_day3_max_temp_state: "brightsky.0.daily.02.temperature_max",
        });
        strict_1.default.equal(cfg.enabled, true);
        strict_1.default.equal(cfg.days[0].dayIndex, 3);
        strict_1.default.equal(cfg.days[0].minTempStateId, "brightsky.0.daily.02.temperature_min");
        strict_1.default.equal(cfg.days[4].dayIndex, 7);
        strict_1.default.equal(cfg.days[4].minTempStateId, "");
    });
});
(0, node_test_1.describe)("weather horizon run", () => {
    (0, node_test_1.it)("writes valid min/max and leaves unmapped days as missing (no fake 0)", async () => {
        const mock = mockHost({
            learning_weather_horizon_enabled: true,
            learning_weather_horizon_day3_min_temp_state: "bs.min3",
            learning_weather_horizon_day3_max_temp_state: "bs.max3",
        }, { "bs.min3": 12.5, "bs.max3": 21 });
        await (0, index_js_1.ensureWeatherHorizonStates)(mock.host);
        await (0, index_js_1.runWeatherHorizon)(mock.host);
        const d3 = (0, index_js_1.weatherHorizonDayStatePrefix)(3);
        strict_1.default.equal(mock.states.get(`${d3}.min_temp_c`)?.val, 12.5);
        strict_1.default.equal(mock.states.get(`${d3}.max_temp_c`)?.val, 21);
        strict_1.default.equal(mock.states.get(`${d3}.quality`)?.val, "valid");
        const d4 = (0, index_js_1.weatherHorizonDayStatePrefix)(4);
        strict_1.default.equal(mock.states.get(`${d4}.min_temp_c`)?.val, null);
        strict_1.default.equal(mock.states.get(`${d4}.quality`)?.val, "missing");
        strict_1.default.equal(mock.states.get("learning.weather.horizon.days_available")?.val, 1);
        strict_1.default.equal(mock.states.get("learning.weather.horizon.status")?.val, "ready");
    });
    (0, node_test_1.it)("partial mapping is degraded, not fabricated", async () => {
        const mock = mockHost({
            learning_weather_horizon_day5_min_temp_state: "bs.min5",
        }, { "bs.min5": 8 });
        await (0, index_js_1.ensureWeatherHorizonStates)(mock.host);
        await (0, index_js_1.runWeatherHorizon)(mock.host);
        const d5 = (0, index_js_1.weatherHorizonDayStatePrefix)(5);
        strict_1.default.equal(mock.states.get(`${d5}.min_temp_c`)?.val, 8);
        strict_1.default.equal(mock.states.get(`${d5}.max_temp_c`)?.val, null);
        strict_1.default.equal(mock.states.get(`${d5}.quality`)?.val, "degraded");
    });
});

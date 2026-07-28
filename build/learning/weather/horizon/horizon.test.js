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
                return v === null
                    ? { val: null, ack: true, ts: 1, lc: 1, from: "t" }
                    : { val: v, ack: true, ts: 1, lc: 1, from: "t" };
            },
            setStateAsync: async (id, st) => {
                states.set(id, { val: st.val, ack: st.ack === true });
            },
            log: { info: () => undefined, warn: () => undefined, debug: () => undefined },
        },
    };
}
(0, node_test_1.describe)("weather horizon math", () => {
    (0, node_test_1.it)("applies weighted additive bias like PV", () => {
        strict_1.default.equal((0, index_js_1.effectiveTempBiasC)(2, 1), 2);
        strict_1.default.equal((0, index_js_1.effectiveTempBiasC)(2, 2), 1.8);
        strict_1.default.equal((0, index_js_1.correctHorizonTempC)(10, 2, 1), 12);
        strict_1.default.equal((0, index_js_1.correctHorizonTempC)(null, 2, 1), null);
        strict_1.default.equal((0, index_js_1.correctHorizonTempC)(10, null, 1), 10);
        strict_1.default.equal((0, index_js_1.dailyTempBiasSample)(12, 10), 2);
        strict_1.default.equal((0, index_js_1.emaBiasC)(null, 4), 4);
    });
});
(0, node_test_1.describe)("weather horizon config", () => {
    (0, node_test_1.it)("parses day 1-7 mappings", () => {
        const cfg = (0, index_js_1.weatherHorizonConfigFromAdapter)({
            learning_weather_horizon_day1_min_temp_state: "brightsky.0.daily.00.temperature_min",
            learning_weather_horizon_day1_max_temp_state: "brightsky.0.daily.00.temperature_max",
            learning_weather_horizon_day3_min_temp_state: "brightsky.0.daily.02.temperature_min",
        });
        strict_1.default.equal(cfg.enabled, true);
        strict_1.default.equal(cfg.days[0].dayIndex, 1);
        strict_1.default.equal(cfg.days[0].minTempStateId, "brightsky.0.daily.00.temperature_min");
        strict_1.default.equal(cfg.days[2].dayIndex, 3);
        strict_1.default.equal(cfg.days[6].dayIndex, 7);
    });
});
(0, node_test_1.describe)("weather horizon run", () => {
    (0, node_test_1.it)("writes raw+corrected for day1-7 and leaves unmapped as missing", async () => {
        const mock = mockHost({
            learning_weather_horizon_enabled: true,
            learning_weather_horizon_day1_min_temp_state: "bs.min1",
            learning_weather_horizon_day1_max_temp_state: "bs.max1",
            learning_weather_horizon_day3_min_temp_state: "bs.min3",
            learning_weather_horizon_day3_max_temp_state: "bs.max3",
            learning_weather_actual_temp_state: "live.temp",
            learning_weather_forecast_temp_state: "fc.temp",
        }, { "bs.min1": 8, "bs.max1": 18, "bs.min3": 12.5, "bs.max3": 21, "live.temp": 14 });
        mock.states.set("learning.weather.temp_bias_c", { val: 1, ack: true });
        await (0, index_js_1.ensureWeatherHorizonStates)(mock.host);
        await (0, index_js_1.runWeatherHorizon)(mock.host);
        const d1 = (0, index_js_1.weatherHorizonDayStatePrefix)(1);
        strict_1.default.equal(mock.states.get(`${d1}.raw_min_temp_c`)?.val, 8);
        strict_1.default.equal(mock.states.get(`${d1}.min_temp_c`)?.val, 9); // +1°C full weight
        strict_1.default.equal(mock.states.get(`${d1}.quality`)?.val, "valid");
        const d3 = (0, index_js_1.weatherHorizonDayStatePrefix)(3);
        strict_1.default.equal(mock.states.get(`${d3}.raw_min_temp_c`)?.val, 12.5);
        strict_1.default.equal(mock.states.get(`${d3}.min_temp_c`)?.val, 13.3); // +1 * 0.8
        const d2 = (0, index_js_1.weatherHorizonDayStatePrefix)(2);
        strict_1.default.equal(mock.states.get(`${d2}.quality`)?.val, "missing");
        strict_1.default.equal(mock.states.get("learning.weather.horizon.freeze_date")?.val?.toString().length, 10);
        strict_1.default.equal(mock.states.get("learning.weather.horizon.observed_min_temp_c")?.val, 14);
    });
});

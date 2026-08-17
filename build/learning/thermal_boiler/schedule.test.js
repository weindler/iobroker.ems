"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_query_1 = require("../history_query");
const index_1 = require("../pv_bias/index");
const run_1 = require("./run");
const tree_paths_1 = require("../../tree_paths");
const BOILER_MAP = (0, tree_paths_1.mappingBase)("immersion_heater", "boiler_temp_c");
function stubHost() {
    const states = {
        [`${BOILER_MAP}.enabled`]: true,
        [`${BOILER_MAP}.target_state`]: "sensor.0.boiler",
    };
    const log = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    };
    return {
        config: {
            learning_pv_bias_enabled: false,
            learning_thermal_runtime_enabled: true,
            learning_thermal_runtime_lookback_days: 7,
            learning_house_load_enabled: false,
            learning_battery_runtime_enabled: false,
            learning_price_enabled: false,
            learning_price_forecast_enabled: false,
            learning_pv_horizon_enabled: false,
            ih_boiler_min_temp_c: 50,
            ih_hygiene_target_temp_c: 60,
            ih_boiler_temp_c_enabled: true,
            ih_boiler_temp_c_target: "sensor.0.boiler",
        },
        states,
        getStateAsync: async (id) => ({ val: states[id] ?? null }),
        setStateAsync: async (id, state) => {
            states[id] = state.val;
        },
        setObjectNotExistsAsync: async () => undefined,
        getForeignStateAsync: async (id) => id === "sensor.0.boiler" ? { val: 59 } : { val: null },
        getHistoryAsync: async () => ({ result: [] }),
        log,
    };
}
function stubAdapter(host) {
    return {
        config: host.config,
        log: host.log,
    };
}
async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise((r) => setTimeout(r, 20));
    }
}
(0, node_test_1.describe)("thermal boiler learning scheduling", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, index_1.__resetLearningRuntimeForTest)();
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        (0, history_query_1.resetHistoryQueryQueueForTests)();
    });
    (0, node_test_1.afterEach)(() => {
        (0, index_1.stopPvBiasLearning)();
        (0, index_1.__resetLearningRuntimeForTest)();
        (0, run_1.__resetThermalBoilerRunLockForTest)();
        (0, history_query_1.resetHistoryQueryQueueForTests)();
    });
    (0, node_test_1.it)("T30: start replaces timer — no duplicate interval after restart", async () => {
        const host = stubHost();
        const adapter = stubAdapter(host);
        await (0, index_1.startPvBiasLearningRuntime)(adapter, host);
        strict_1.default.equal((0, index_1.__hasPvBiasLearningTimerForTest)(), true);
        await waitUntil(() => !(0, index_1.__isLearningTickInFlightForTest)(), 2_000);
        await (0, index_1.startPvBiasLearningRuntime)(adapter, host);
        strict_1.default.equal((0, index_1.__hasPvBiasLearningTimerForTest)(), true);
        await waitUntil(() => !(0, index_1.__isLearningTickInFlightForTest)(), 2_000);
        (0, index_1.stopPvBiasLearning)();
        strict_1.default.equal((0, index_1.__hasPvBiasLearningTimerForTest)(), false);
    });
    (0, node_test_1.it)("T31: startup tick writes boiler mapping temp before heavy history modules", async () => {
        const host = stubHost();
        const states = host.states;
        states["learning.thermal_boiler.current_temperature_c"] = 63;
        await (0, index_1.startPvBiasLearningRuntime)(stubAdapter(host), host);
        await waitUntil(() => states["learning.thermal_boiler.current_temperature_c"] === 59, 2_000);
        strict_1.default.equal(states["learning.thermal_boiler.current_temperature_c"], 59);
        strict_1.default.match(String(states["learning.thermal_boiler.reason_de"] ?? ""), /59\.0/);
        await waitUntil(() => !(0, index_1.__isLearningTickInFlightForTest)(), 2_000);
        (0, index_1.stopPvBiasLearning)();
    });
});

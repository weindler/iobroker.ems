"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_tick_js_1 = require("./grid_tick.js");
const grid_states_js_1 = require("./grid_states.js");
function sampleForecast(overrides = {}) {
    return {
        generatedAt: "2026-07-11T10:00:00.000Z",
        validUntil: null,
        source: "fixed_tariff",
        currentPriceCtPerKwh: 30,
        gridImportAllowed: true,
        configuredMaxGridImportW: 11000,
        configuredHouseFuseLimitW: 11000,
        effectiveMaxGridImportW: 11000,
        slots: [],
        quality: { status: "valid", reasonDe: "test", confidencePct: 100 },
        reasonDe: "test",
        ...overrides,
    };
}
function sampleInput() {
    return {
        now: new Date("2026-07-11T10:00:00.000Z"),
        globalMode: "balanced",
        policyGridImportAllowed: true,
        configuredMaxGridImportW: 11000,
        configuredHouseFuseLimitW: 11000,
        currentPriceCtPerKwh: 30,
        fixedPriceCtPerKwh: 30,
        dynamicSlots: [],
    };
}
function mockHost(initial = {}) {
    const store = new Map(Object.entries(initial));
    let getCalls = 0;
    let failOnWriteId = null;
    return {
        store,
        get getCalls() {
            return getCalls;
        },
        setFailOnWriteId(id) {
            failOnWriteId = id;
        },
        config: {},
        log: { warn() { } },
        async setObjectNotExistsAsync() { },
        async getStateAsync(id) {
            getCalls++;
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            if (failOnWriteId && id === failOnWriteId) {
                throw new Error(`write failed: ${id}`);
            }
            store.set(id, state.val);
        },
    };
}
(0, node_test_1.describe)("grid supply revision writes", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, grid_tick_js_1.resetGridSupplyRevisionForTest)();
    });
    (0, node_test_1.it)("same revision with existing state reads before compare and skips unchanged writes", async () => {
        const forecast = sampleForecast();
        const input = sampleInput();
        const host = mockHost({
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.status]: forecast.quality.status,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.source]: forecast.source,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.generatedAt]: forecast.generatedAt,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.validUntil]: "",
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh]: forecast.currentPriceCtPerKwh ?? 0,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.importAllowed]: forecast.gridImportAllowed,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.maxImportPowerW]: forecast.effectiveMaxGridImportW ?? 0,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.slotsJson]: "[]",
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.reasonDe]: forecast.reasonDe,
            [grid_states_js_1.GRID_SUPPLY_STATE_IDS.revision]: 1,
        });
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast, input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 1);
        const readsAfterFirst = host.getCalls;
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast, input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 1);
        strict_1.default.ok(host.getCalls > readsAfterFirst);
    });
    (0, node_test_1.it)("same revision with missing state writes new values via skipRead", async () => {
        const forecast = sampleForecast();
        const input = sampleInput();
        const host = mockHost();
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast, input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 1);
        strict_1.default.equal(host.store.get(grid_states_js_1.GRID_SUPPLY_STATE_IDS.revision), 1);
        strict_1.default.equal(host.getCalls, 0);
    });
    (0, node_test_1.it)("new revision uses skipRead and commits cache only after successful writes", async () => {
        const input = sampleInput();
        const host = mockHost();
        const first = sampleForecast({ currentPriceCtPerKwh: 30 });
        const second = sampleForecast({ currentPriceCtPerKwh: 31 });
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast: first, input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 1);
        const readsAfterFirst = host.getCalls;
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast: second, input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 2);
        strict_1.default.equal(host.store.get(grid_states_js_1.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh), 31);
        strict_1.default.equal(host.getCalls, readsAfterFirst);
    });
    (0, node_test_1.it)("failed write does not advance revision cache", async () => {
        const input = sampleInput();
        const host = mockHost();
        host.setFailOnWriteId(grid_states_js_1.GRID_SUPPLY_STATE_IDS.revision);
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast: sampleForecast({ reasonDe: "boom" }), input });
        strict_1.default.equal((0, grid_tick_js_1.gridSupplyRevisionForTest)(), 0);
        strict_1.default.equal(host.store.has(grid_states_js_1.GRID_SUPPLY_STATE_IDS.revision), false);
    });
});
(0, node_test_1.describe)("planner shared grid input", () => {
    (0, node_test_1.it)("does not mutate prebuilt grid input during grid supply tick", async () => {
        (0, grid_tick_js_1.resetGridSupplyRevisionForTest)();
        const input = sampleInput();
        const inputSnapshot = JSON.stringify(input);
        const forecast = sampleForecast();
        const host = mockHost();
        await (0, grid_tick_js_1.runGridSupplyTick)(host, { forecast, input });
        strict_1.default.equal(JSON.stringify(input), inputSnapshot);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const build_js_1 = require("./build.js");
const states_js_1 = require("./states.js");
const tick_js_1 = require("./tick.js");
const deferred_writes_js_1 = require("./deferred_writes.js");
const quality_js_1 = require("../quality.js");
const pv_js_1 = require("../contributions/pv.js");
const house_load_js_1 = require("../contributions/house_load.js");
const constraints_js_1 = require("../contributions/constraints.js");
function mockHost(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        config: {},
        log: { warn() { }, info() { } },
        async setObjectNotExistsAsync() { },
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
    };
}
(0, node_test_1.describe)("forecast revision persistence", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, tick_js_1.resetForecastPlanRevisionForTest)();
    });
    (0, node_test_1.it)("cold start with matching stored semantic hash keeps revision and skips rewrite", async () => {
        const host = mockHost({
            [states_js_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "abc123",
            [states_js_1.FORECAST_PLAN_STATE_IDS.revision]: 7,
        });
        const result = await (0, tick_js_1.resolveForecastRevisionChangeForTest)(host, "payload", "abc123");
        strict_1.default.equal(result.revisionChanged, false);
        strict_1.default.equal(result.skipLargeJsonWrites, true);
        strict_1.default.equal(result.skipReason, "stored_hash_match");
        strict_1.default.equal(result.nextRevision, 7);
        strict_1.default.equal((0, tick_js_1.forecastPlanRevisionForTest)(), 7);
    });
    (0, node_test_1.it)("cold start with different semantic hash bumps revision", async () => {
        const host = mockHost({
            [states_js_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
            [states_js_1.FORECAST_PLAN_STATE_IDS.revision]: 2,
        });
        const result = await (0, tick_js_1.resolveForecastRevisionChangeForTest)(host, "payload", "new");
        strict_1.default.equal(result.revisionChanged, true);
        strict_1.default.equal(result.skipLargeJsonWrites, false);
        strict_1.default.equal(result.nextRevision, 1);
    });
    (0, node_test_1.it)("semantic hash change with deferLargeJsonWrites schedules deferred write path", async () => {
        const host = mockHost({
            [states_js_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
            [states_js_1.FORECAST_PLAN_STATE_IDS.revision]: 2,
        });
        const result = await (0, tick_js_1.resolveForecastRevisionChangeForTest)(host, "payload", "new", true);
        strict_1.default.equal(result.revisionChanged, true);
        strict_1.default.equal(result.deferLargeJsonWrites, true);
        strict_1.default.equal((0, deferred_writes_js_1.hasDeferredForecastPlanWrite)(), false);
    });
    (0, node_test_1.it)("missing stored hash on cold start requires rewrite", async () => {
        const host = mockHost();
        const result = await (0, tick_js_1.resolveForecastRevisionChangeForTest)(host, "payload", "hash");
        strict_1.default.equal(result.revisionChanged, true);
        strict_1.default.equal(result.nextRevision, 1);
    });
});
function gridForecast() {
    return {
        generatedAt: "2026-07-11T10:00:00.000Z",
        validUntil: null,
        source: "dynamic_tariff",
        currentPriceCtPerKwh: 24,
        gridImportAllowed: true,
        configuredMaxGridImportW: 11000,
        configuredHouseFuseLimitW: 13800,
        effectiveMaxGridImportW: 11000,
        slots: [],
        quality: (0, quality_js_1.operatorQuality)("valid", "Grid OK"),
        reasonDe: "Grid OK",
    };
}
function minimalStoredPlanJson() {
    const now = new Date("2026-07-11T10:00:00.000Z");
    const contributions = [
        (0, pv_js_1.buildPvContribution)({
            now,
            correctedTodayKwh: 15,
            correctedTomorrowKwh: 18,
            rawTodayKwh: 14,
            rawTomorrowKwh: 17,
            confidencePct: 80,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [
                { dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 15, confidencePct: 80 },
                { dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 18, confidencePct: 80 },
            ],
        }),
        (0, house_load_js_1.buildHouseLoadContribution)({
            now,
            timezone: "UTC",
            status: "ready",
            confidence: 70,
            forecastToday: {
                date: "2026-07-11",
                season: "summer",
                weekday: "saturday",
                day_type: "weekend",
                segments: {
                    midday: { avg_w: 1000, source: "p", fallback_level: "none", confidence: 70 },
                },
            },
            forecastTomorrow: null,
            lastUpdate: now.toISOString(),
        }),
        (0, constraints_js_1.buildGridSupplyContribution)(gridForecast()),
    ];
    const plan = (0, build_js_1.buildForecastPlan)({ now, timezone: "UTC", contributions });
    plan.revision = 3;
    return JSON.stringify(plan);
}
(0, node_test_1.describe)("forecast bootstrap cache", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, tick_js_1.resetForecastPlanRevisionForTest)();
    });
    (0, node_test_1.it)("uses cached plan_json during bootstrap without scheduling duplicate refresh when already deferred", async () => {
        const planJson = minimalStoredPlanJson();
        const host = mockHost({
            [states_js_1.FORECAST_PLAN_STATE_IDS.status]: "ready",
            [states_js_1.FORECAST_PLAN_STATE_IDS.planJson]: planJson,
            [states_js_1.FORECAST_PLAN_STATE_IDS.revision]: 3,
        });
        let getStateCalls = 0;
        const origGet = host.getStateAsync.bind(host);
        host.getStateAsync = async (id) => {
            getStateCalls++;
            return origGet(id);
        };
        const plan = await (0, tick_js_1.runForecastPlanTick)(host, gridForecast(), [], { deferLargeJsonWrites: true });
        strict_1.default.equal(plan.revision, 3);
        strict_1.default.equal(plan.slots.length > 0, true);
        strict_1.default.equal((0, deferred_writes_js_1.hasDeferredForecastPlanWrite)(), true);
        strict_1.default.equal(getStateCalls <= 4, true, `expected at most 4 state reads, got ${getStateCalls}`);
        strict_1.default.equal(host.store.has(states_js_1.FORECAST_PLAN_STATE_IDS.planJson), true);
    });
});

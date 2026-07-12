"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const states_js_1 = require("./states.js");
const tick_js_1 = require("./tick.js");
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
        strict_1.default.equal(result.nextRevision, 1);
    });
    (0, node_test_1.it)("missing stored hash on cold start requires rewrite", async () => {
        const host = mockHost();
        const result = await (0, tick_js_1.resolveForecastRevisionChangeForTest)(host, "payload", "hash");
        strict_1.default.equal(result.revisionChanged, true);
        strict_1.default.equal(result.nextRevision, 1);
    });
});

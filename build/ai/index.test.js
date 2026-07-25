"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
const ensure_states_js_1 = require("./ensure_states.js");
const states_js_1 = require("../operator/daily_plan/states.js");
(0, node_test_1.describe)("ai state change routing", () => {
    (0, node_test_1.it)("isAiRelatedState only matches the optimize-now button id", () => {
        strict_1.default.equal((0, index_js_1.isAiRelatedState)(ensure_states_js_1.AI_STATES.optimizeNowRequest), true);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)("ai.status"), false);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)("backup.export_request"), false);
    });
    (0, node_test_1.it)("ignores ack=true / val!=true / unrelated ids (no run, no ack-flip)", async () => {
        const store = new Map();
        const host = {
            config: {},
            log: { debug() { }, warn() { }, error() { } },
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handledAckTrue = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, true, true);
        strict_1.default.equal(handledAckTrue, false);
        const handledFalseVal = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, false, false);
        strict_1.default.equal(handledFalseVal, false);
        const handledOther = await (0, index_js_1.handleAiStateChange)(host, "ai.status", true, false);
        strict_1.default.equal(handledOther, false);
    });
    (0, node_test_1.it)("val=true/ack=false → resets button and attempts a run (fail-closed: no plan → no throw)", async () => {
        const store = new Map();
        const host = {
            config: {},
            log: { debug() { }, warn() { }, error() { } },
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handled = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, true, false);
        strict_1.default.equal(handled, true);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.optimizeNowRequest), false);
        // no daily plan present in the mock host → runAiOptimizationManual resolves without throwing
        strict_1.default.equal(store.get(states_js_1.DAILY_PLAN_STATE_IDS.planJson), undefined);
    });
});

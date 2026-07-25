"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ensure_states_js_1 = require("./ensure_states.js");
function mockHost() {
    const objects = new Set();
    const states = new Map();
    return {
        objects,
        states,
        host: {
            setObjectNotExistsAsync: async (id) => {
                objects.add(id);
            },
            getStateAsync: async (id) => {
                const v = states.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            setStateAsync: async (id, st) => {
                states.set(id, st.val);
            },
        },
    };
}
(0, node_test_1.describe)("ensureCompareStates", () => {
    (0, node_test_1.it)("creates the compare channel and all compare.* states with safe defaults", async () => {
        const mock = mockHost();
        await (0, ensure_states_js_1.ensureCompareStates)(mock.host);
        strict_1.default.ok(mock.objects.has("compare"));
        strict_1.default.ok(mock.objects.has("compare.plan_a"));
        strict_1.default.ok(mock.objects.has("compare.plan_b"));
        for (const id of Object.values(ensure_states_js_1.COMPARE_STATES)) {
            strict_1.default.ok(mock.objects.has(id), `expected object for ${id}`);
        }
        strict_1.default.equal(mock.states.get(ensure_states_js_1.COMPARE_STATES.activePlan), "a");
        strict_1.default.equal(mock.states.get(ensure_states_js_1.COMPARE_STATES.planAChartJson), "[]");
        strict_1.default.equal(mock.states.get(ensure_states_js_1.COMPARE_STATES.deltaSummaryJson), "{}");
    });
});

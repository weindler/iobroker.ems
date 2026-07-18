"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const states_js_1 = require("./states.js");
const runtime_js_1 = require("./runtime.js");
const runtime_session_js_1 = require("./runtime_session.js");
function memoryHost(config = {}) {
    const objects = new Map();
    const states = new Map();
    const order = [];
    return {
        namespace: "ems.0",
        config,
        log: { debug() { }, info() { }, warn() { }, error() { } },
        objects,
        states,
        order,
        async setObjectNotExistsAsync(id, obj) {
            order.push(`object:${id}`);
            if (!objects.has(id))
                objects.set(id, obj);
        },
        async getStateAsync(id) {
            return states.has(id) ? { val: states.get(id), ack: true } : null;
        },
        async setStateAsync(id, st) {
            order.push(`state:${id}`);
            const v = st && typeof st === "object" && st !== null && "val" in st ? st.val : st;
            states.set(id, v);
        },
        async extendObjectAsync() { },
        async subscribeStatesAsync() { },
        async unsubscribeStatesAsync() { },
    };
}
(0, node_test_1.describe)("planner_authorization cold start", () => {
    (0, node_test_1.it)("creates authorization objects before the first state write", async () => {
        (0, runtime_session_js_1.resetAuthorizationSessionForTest)();
        const host = memoryHost({ planner_takeover_authorization_mode: "disabled" });
        await (0, runtime_js_1.initPlannerAuthorizationRuntime)(host);
        const firstObject = host.order.findIndex((e) => e.startsWith("object:"));
        const firstState = host.order.findIndex((e) => e.startsWith("state:"));
        strict_1.default.ok(firstObject >= 0, "expected object ensure");
        strict_1.default.ok(firstState >= 0, "expected state write");
        strict_1.default.ok(firstObject < firstState, "objects must be ensured before state writes");
        strict_1.default.ok(host.objects.has(states_js_1.PLANNER_AUTHORIZATION_STATE_IDS.configuredMode));
        await (0, runtime_js_1.stopPlannerAuthorizationRuntime)();
    });
    (0, node_test_1.it)("ensurePlannerAuthorizationStates is idempotent", async () => {
        const host = memoryHost();
        await (0, states_js_1.ensurePlannerAuthorizationStates)(host);
        await (0, states_js_1.ensurePlannerAuthorizationStates)(host);
        strict_1.default.ok(host.objects.has(states_js_1.PLANNER_AUTHORIZATION_STATE_IDS.blockReasonCount));
    });
});

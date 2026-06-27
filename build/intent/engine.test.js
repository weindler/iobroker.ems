"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const engine_js_1 = require("./engine.js");
function mockHost() {
    const store = new Map();
    return {
        subscribeCount: 0,
        unsubscribeCount: 0,
        foreignSubscribeCount: 0,
        patterns: [],
        store,
        config: {},
        namespace: "ems.0",
        log: { info() { }, warn() { }, debug() { } },
        async setObjectNotExistsAsync() { },
        async getStateAsync(id) {
            const e = store.get(id);
            return e === undefined ? null : { val: e.val, ack: e.ack };
        },
        async setStateAsync(id, state) {
            store.set(id, { val: state.val, ack: state.ack ?? true });
        },
        async subscribeStatesAsync(pattern) {
            this.subscribeCount++;
            this.patterns.push(pattern);
        },
        async unsubscribeStatesAsync(pattern) {
            this.unsubscribeCount++;
            const i = this.patterns.indexOf(pattern);
            if (i >= 0)
                this.patterns.splice(i, 1);
        },
        async subscribeForeignStatesAsync() {
            this.foreignSubscribeCount++;
        },
        async unsubscribeForeignStatesAsync() { },
        async getForeignStateAsync() {
            return null;
        },
    };
}
(0, node_test_1.describe)("intent engine lifecycle", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.resetIntentEngineForTest)();
    });
    (0, node_test_1.it)("subscribes request state once on init", async () => {
        const host = mockHost();
        await (0, engine_js_1.initIntentEngine)(host);
        strict_1.default.equal(host.subscribeCount, 1);
        strict_1.default.ok(host.patterns.includes("user_intent.inputs.iobroker.wallbox.request_json"));
    });
    (0, node_test_1.it)("does not double-subscribe on repeated init", async () => {
        const host = mockHost();
        await (0, engine_js_1.initIntentEngine)(host);
        await (0, engine_js_1.initIntentEngine)(host);
        strict_1.default.equal(host.subscribeCount, 1);
    });
    (0, node_test_1.it)("unsubscribes on stop", async () => {
        const host = mockHost();
        await (0, engine_js_1.initIntentEngine)(host);
        (0, engine_js_1.stopIntentEngine)();
        await Promise.resolve();
        strict_1.default.equal(host.unsubscribeCount, 1);
    });
    (0, node_test_1.it)("re-init after stop works", async () => {
        const host = mockHost();
        await (0, engine_js_1.initIntentEngine)(host);
        (0, engine_js_1.stopIntentEngine)();
        await (0, engine_js_1.initIntentEngine)(host);
        strict_1.default.equal(host.subscribeCount, 2);
    });
    (0, node_test_1.it)("handleIntentStateChange processes unacked request", async () => {
        const host = mockHost();
        await (0, engine_js_1.initIntentEngine)(host);
        const req = {
            schema_version: 1,
            request_id: "lifecycle-1",
            issued_at: new Date().toISOString(),
            owner: { type: "user" },
            values: { charge_strategy: "pv" },
        };
        host.store.set("user_intent.inputs.iobroker.wallbox.request_json", {
            val: JSON.stringify(req),
            ack: false,
        });
        (0, engine_js_1.handleIntentStateChange)("ems.0", "ems.0.user_intent.inputs.iobroker.wallbox.request_json", {
            val: JSON.stringify(req),
            ack: false,
        });
        await new Promise((r) => setTimeout(r, 20));
        const result = host.store.get("user_intent.inputs.iobroker.wallbox.result_json");
        strict_1.default.ok(result);
        const parsed = JSON.parse(String(result.val));
        strict_1.default.equal(parsed.status, "accepted");
    });
});

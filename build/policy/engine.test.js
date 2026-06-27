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
        subscribedPatterns: [],
        config: {},
        log: {
            info() { },
            warn() { },
            debug() { },
        },
        async setObjectNotExistsAsync() { },
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
        async subscribeStatesAsync(pattern) {
            this.subscribeCount++;
            this.subscribedPatterns.push(pattern);
        },
        async unsubscribeStatesAsync(pattern) {
            this.unsubscribeCount++;
            const idx = this.subscribedPatterns.indexOf(pattern);
            if (idx >= 0) {
                this.subscribedPatterns.splice(idx, 1);
            }
        },
    };
}
(0, node_test_1.describe)("policy engine lifecycle", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, engine_js_1.stopPolicyEngine)();
        engine_js_1.policyProviderRegistry.clear();
    });
    (0, node_test_1.it)("registers subscription exactly once on init", async () => {
        const host = mockHost();
        await (0, engine_js_1.initPolicyEngine)(host);
        strict_1.default.equal(host.subscribeCount, 1);
        strict_1.default.deepEqual(host.subscribedPatterns, ["global_modes.requested"]);
    });
    (0, node_test_1.it)("does not double-subscribe on repeated init without stop", async () => {
        const host = mockHost();
        await (0, engine_js_1.initPolicyEngine)(host);
        await (0, engine_js_1.initPolicyEngine)(host);
        strict_1.default.equal(host.subscribeCount, 1);
    });
    (0, node_test_1.it)("removes subscription exactly once on stop", async () => {
        const host = mockHost();
        await (0, engine_js_1.initPolicyEngine)(host);
        (0, engine_js_1.stopPolicyEngine)();
        await Promise.resolve();
        strict_1.default.equal(host.unsubscribeCount, 1);
        strict_1.default.deepEqual(host.subscribedPatterns, []);
    });
    (0, node_test_1.it)("re-subscribes exactly once after stop and re-init", async () => {
        const host = mockHost();
        await (0, engine_js_1.initPolicyEngine)(host);
        (0, engine_js_1.stopPolicyEngine)();
        await Promise.resolve();
        await (0, engine_js_1.initPolicyEngine)(host);
        strict_1.default.equal(host.subscribeCount, 2);
        strict_1.default.equal(host.unsubscribeCount, 1);
        strict_1.default.deepEqual(host.subscribedPatterns, ["global_modes.requested"]);
    });
    (0, node_test_1.it)("does not throw when unsubscribe rejects during stop", async () => {
        const host = mockHost();
        host.unsubscribeStatesAsync = async () => {
            throw new Error("unsubscribe failed");
        };
        await (0, engine_js_1.initPolicyEngine)(host);
        strict_1.default.doesNotThrow(() => (0, engine_js_1.stopPolicyEngine)());
        await Promise.resolve();
    });
});

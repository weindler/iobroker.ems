"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const state_write_js_1 = require("./state_write.js");
function mockHost(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        writes: [],
        async setObjectNotExistsAsync() { },
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            this.writes.push({ id, val: state.val });
            store.set(id, state.val);
        },
    };
}
(0, node_test_1.describe)("policy state write", () => {
    (0, node_test_1.it)("unchanged value is not written", async () => {
        const host = mockHost({ "policy.global.revision": "abc" });
        const changed = await (0, state_write_js_1.setStateIfChanged)(host, "policy.global.revision", "abc");
        strict_1.default.equal(changed, false);
        strict_1.default.equal(host.writes.length, 0);
    });
    (0, node_test_1.it)("changed value is written", async () => {
        const host = mockHost({ "policy.global.revision": "abc" });
        const changed = await (0, state_write_js_1.setStateIfChanged)(host, "policy.global.revision", "def");
        strict_1.default.equal(changed, true);
        strict_1.default.equal(host.writes.length, 1);
    });
});

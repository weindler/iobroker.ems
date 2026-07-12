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
            this.writes.push({
                id,
                val: state.val,
                ack: state.ack ?? false,
            });
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
    (0, node_test_1.it)("skipRead writes without loading current state", async () => {
        const host = mockHost({ "planner.intent.forecast_plan.plan_json": "huge-old-payload" });
        let getCalls = 0;
        const origGet = host.getStateAsync.bind(host);
        host.getStateAsync = async (id) => {
            getCalls++;
            return origGet(id);
        };
        const changed = await (0, state_write_js_1.setStateIfChanged)(host, "planner.intent.forecast_plan.plan_json", "{}", {
            skipRead: true,
        });
        strict_1.default.equal(changed, true);
        strict_1.default.equal(getCalls, 0);
        strict_1.default.equal(host.writes.length, 1);
        strict_1.default.equal(host.writes[0].val, "{}");
        strict_1.default.equal(host.writes[0].ack, true);
    });
    (0, node_test_1.it)("missing state with unchanged revision still reads before first write", async () => {
        const host = mockHost();
        let getCalls = 0;
        const origGet = host.getStateAsync.bind(host);
        host.getStateAsync = async (id) => {
            getCalls++;
            return origGet(id);
        };
        const changed = await (0, state_write_js_1.setStateIfChanged)(host, "planner.intent.supply.grid.revision", 1);
        strict_1.default.equal(changed, true);
        strict_1.default.equal(getCalls, 1);
        strict_1.default.equal(host.writes.length, 1);
        strict_1.default.equal(host.writes[0].ack, true);
    });
});

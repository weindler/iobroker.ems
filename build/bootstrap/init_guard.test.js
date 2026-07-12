"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const init_guard_js_1 = require("../diagnostics/init_guard.js");
const engine_js_1 = require("../intent/engine.js");
const persist_hydrate_js_1 = require("./persist_hydrate.js");
function mockIntentHost() {
    return {
        config: {},
        namespace: "ems.0",
        log: { info() { }, warn() { }, debug() { } },
        async setObjectNotExistsAsync() { },
        async getStateAsync() {
            return null;
        },
        async setStateAsync() { },
        async subscribeStatesAsync() { },
        async unsubscribeStatesAsync() { },
        async subscribeForeignStatesAsync() { },
        async unsubscribeForeignStatesAsync() { },
        async getForeignStateAsync() {
            return null;
        },
    };
}
(0, node_test_1.describe)("module init guard", () => {
    (0, node_test_1.afterEach)(() => {
        (0, init_guard_js_1.resetModuleInitGuardForTest)();
        (0, engine_js_1.resetIntentEngineForTest)();
        (0, engine_js_1.stopIntentEngine)();
    });
    (0, node_test_1.it)("persist hydration is marked exactly once per hydratePersistedState call", async () => {
        const adapter = {
            config: {},
            log: { info() { }, warn() { }, debug() { } },
            getAbsolutePath: () => undefined,
            setObjectNotExistsAsync: async () => { },
            getStateAsync: async () => null,
            setStateAsync: async () => { },
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async () => { },
        };
        await (0, persist_hydrate_js_1.hydratePersistedState)(adapter);
        strict_1.default.equal((0, init_guard_js_1.getModuleInitCounts)().get("persist_hydration"), 1);
    });
    (0, node_test_1.it)("intent engine init is marked exactly once per initIntentEngine call", async () => {
        await (0, engine_js_1.initIntentEngine)(mockIntentHost());
        strict_1.default.equal((0, init_guard_js_1.getModuleInitCounts)().get("intent_engine"), 1);
    });
    (0, node_test_1.it)("planner runtime marker increments once per explicit mark", () => {
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("planner_runtime").duplicate, false);
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("planner_runtime").duplicate, true);
        strict_1.default.equal((0, init_guard_js_1.getModuleInitCounts)().get("planner_runtime"), 2);
    });
    (0, node_test_1.it)("immersion runtime marker increments once per explicit mark", () => {
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("immersion_runtime").duplicate, false);
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("immersion_runtime").duplicate, true);
        strict_1.default.equal((0, init_guard_js_1.getModuleInitCounts)().get("immersion_runtime"), 2);
    });
});

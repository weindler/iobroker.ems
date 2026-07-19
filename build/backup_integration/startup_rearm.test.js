"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const startup_rearm_js_1 = require("./startup_rearm.js");
const execution_mode_js_1 = require("../execution_mode.js");
const tree_paths_js_1 = require("../tree_paths.js");
const NS = "ems.0";
const GLOBAL_REL = "global.execution_mode";
const WB_REL = (0, tree_paths_js_1.addonMode)("wallbox");
function freshUserState(val, lc, ts = 2000) {
    return { val, ack: false, ts, lc, from: "system.user.admin" };
}
(0, node_test_1.describe)("startup rearm", () => {
    (0, node_test_1.it)("requires fresh unacked state after bootstrap to clear rearm", () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        strict_1.default.equal((0, startup_rearm_js_1.isFreshUserStateChange)({ val: "live", ack: false, ts: 999 }, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isFreshUserStateChange)({ val: "live", ack: true, ts: 2000 }, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isFreshUserStateChange)({ val: "live", ack: false, ts: 2000 }, 1000), true);
        (0, startup_rearm_js_1.clearStartupRearmRequired)();
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), false);
    });
    (0, node_test_1.it)("1: fresh external live request after bootstrap clears rearm", () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 5);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("live", 6), NS, GLOBAL_REL, 1000), true);
    });
    (0, node_test_1.it)("2: fresh external dryrun request does not clear rearm", () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 5);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(WB_REL, 5);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserExecutionModeRequest)(freshUserState("dryrun", 6), NS, GLOBAL_REL, 1000), true);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("dryrun", 6), NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("live", 6), NS, WB_REL, 1000), false);
    });
    (0, node_test_1.it)("6: adapter origin, stale lc, ack=true and pre-bootstrap are rejected for live rearm", () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 5);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("live", 6, 2000), NS, GLOBAL_REL, 1000), true);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)({ val: "live", ack: false, ts: 2000, from: "system.adapter.ems.0", lc: 6 }, NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)({ val: "live", ack: false, ts: 2000, from: "ems.0", lc: 6 }, NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)({ val: "live", ack: false, ts: 2000, from: "system.user.admin", lc: 5 }, NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)({ val: "live", ack: true, ts: 2000, from: "system.user.admin", lc: 6 }, NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("live", 6, 999), NS, GLOBAL_REL, 1000), false);
        strict_1.default.equal((0, startup_rearm_js_1.isExplicitUserLiveRearmRequest)(freshUserState("invalid", 6), NS, GLOBAL_REL, 1000), false);
    });
    (0, node_test_1.it)("detects adapter-internal origins", () => {
        strict_1.default.equal((0, startup_rearm_js_1.isAdapterInternalStateOrigin)("system.adapter.ems.0", "ems.0"), true);
        strict_1.default.equal((0, startup_rearm_js_1.isAdapterInternalStateOrigin)("ems.0", "ems.0"), true);
        strict_1.default.equal((0, startup_rearm_js_1.isAdapterInternalStateOrigin)("system.user.admin", "ems.0"), false);
    });
});
(0, node_test_1.describe)("startup rearm via handleExecutionModeStateChange", () => {
    function makeAdapter(config = { global_execution_mode: "live" }) {
        const store = new Map();
        return {
            namespace: NS,
            config,
            log: { info: () => { }, warn: () => { } },
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
            store,
        };
    }
    (0, node_test_1.it)("2: dryrun request processes normally but keeps startup_rearm_required", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 1);
        const adapter = makeAdapter({ global_execution_mode: "live" });
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("dryrun", 2));
        strict_1.default.equal(adapter.store.get(GLOBAL_REL)?.val, "dryrun");
        strict_1.default.equal(adapter.store.get(GLOBAL_REL)?.ack, true);
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), true);
        strict_1.default.equal(await (0, execution_mode_js_1.isLiveWriteAllowed)(adapter.getStateAsync, "wallbox"), false);
    });
    (0, node_test_1.it)("3: dryrun then live on another addon mode does not enable writes", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 1);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(WB_REL, 1);
        const adapter = makeAdapter({ global_execution_mode: "live", wb_addon_mode: "live" });
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("dryrun", 2));
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${WB_REL}`, freshUserState("live", 2));
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), true);
        strict_1.default.equal(adapter.store.get(WB_REL)?.val, "live");
        strict_1.default.equal(await (0, execution_mode_js_1.isLiveWriteAllowed)(adapter.getStateAsync, "wallbox"), false);
    });
    (0, node_test_1.it)("4: native live config is mirrored to object tree while rearm blocks writes", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 1);
        const adapter = makeAdapter({ global_execution_mode: "live", wb_addon_mode: "live" });
        await (0, execution_mode_js_1.syncExecutionModesFromConfig)(adapter, adapter.config, {
            forceDryrunReason: "startup_rearm_required",
        });
        strict_1.default.equal(adapter.config.global_execution_mode, "live");
        strict_1.default.equal(adapter.store.get(GLOBAL_REL)?.val, "live");
        strict_1.default.equal(adapter.store.get(WB_REL)?.val, "live");
        strict_1.default.equal(await (0, execution_mode_js_1.isLiveWriteAllowed)(adapter.getStateAsync, "wallbox"), false);
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("dryrun", 2));
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), true);
        strict_1.default.equal(adapter.config.global_execution_mode, "live");
        strict_1.default.equal(await (0, execution_mode_js_1.isLiveWriteAllowed)(adapter.getStateAsync, "wallbox"), false);
    });
    (0, node_test_1.it)("5: second fresh explicit live request completes regular rearm", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 1);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(WB_REL, 1);
        const adapter = makeAdapter({ global_execution_mode: "live", wb_addon_mode: "live" });
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("dryrun", 2));
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), true);
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("live", 3));
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), false);
        strict_1.default.equal(adapter.store.get("info.backup.live_rearm_required")?.val, false);
        await adapter.setStateAsync(WB_REL, { val: "live", ack: true });
        await adapter.setStateAsync(tree_paths_js_1.GLOBAL.executionMode, { val: "live", ack: true });
        strict_1.default.equal(await (0, execution_mode_js_1.isLiveWriteAllowed)(adapter.getStateAsync, "wallbox"), true);
    });
    (0, node_test_1.it)("1: fresh external live request after bootstrap clears rearm via handler", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        (0, startup_rearm_js_1.markBootstrapCompletedForRearm)(1000);
        (0, startup_rearm_js_1.recordExecutionModeBaseline)(GLOBAL_REL, 1);
        const adapter = makeAdapter({ global_execution_mode: "live" });
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, `${NS}.${GLOBAL_REL}`, freshUserState("live", 2));
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), false);
        strict_1.default.equal(adapter.store.get("info.backup.live_rearm_required")?.val, false);
        strict_1.default.equal(adapter.store.get(GLOBAL_REL)?.val, "live");
    });
    (0, node_test_1.it)("confirmStartupLiveRearm clears flag and info state", async () => {
        (0, startup_rearm_js_1.resetStartupRearmForTest)();
        (0, startup_rearm_js_1.setStartupRearmRequired)(true);
        const adapter = makeAdapter({ global_execution_mode: "live" });
        await adapter.setStateAsync(tree_paths_js_1.GLOBAL.executionMode, { val: "live", ack: true });
        const { confirmStartupLiveRearm } = await Promise.resolve().then(() => __importStar(require("./startup_rearm.js")));
        const result = await confirmStartupLiveRearm(adapter);
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal((0, startup_rearm_js_1.isStartupRearmRequired)(), false);
        strict_1.default.equal(adapter.store.get("info.backup.live_rearm_required")?.val, false);
    });
});

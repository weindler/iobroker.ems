"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const execution_mode_js_1 = require("./execution_mode.js");
(0, node_test_1.describe)("execution mode", () => {
    (0, node_test_1.it)("parseMode accepts live and defaults unknown to dryrun", () => {
        strict_1.default.equal((0, execution_mode_js_1.parseMode)("live"), "live");
        strict_1.default.equal((0, execution_mode_js_1.parseMode)("DRYRUN"), "dryrun");
        strict_1.default.equal((0, execution_mode_js_1.parseMode)("invalid"), "dryrun");
    });
    (0, node_test_1.it)("detects execution mode state ids", () => {
        strict_1.default.equal((0, execution_mode_js_1.isExecutionModeStateRelativeId)("global.execution_mode"), true);
        strict_1.default.equal((0, execution_mode_js_1.isExecutionModeStateRelativeId)("addons.immersion_heater.mode"), true);
        strict_1.default.equal((0, execution_mode_js_1.isExecutionModeStateRelativeId)("global_modes.requested"), false);
    });
    (0, node_test_1.it)("acks global execution mode from object tree", async () => {
        const store = new Map();
        const adapter = {
            namespace: "ems.0",
            log: { info: () => { }, warn: () => { } },
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
        };
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, "ems.0.global.execution_mode", {
            val: "live",
            ack: false,
        });
        strict_1.default.equal(store.get("global.execution_mode")?.val, "live");
        strict_1.default.equal(store.get("global.execution_mode")?.ack, true);
        strict_1.default.equal(store.get("execution.safety.global_execution_mode")?.val, "live");
    });
    (0, node_test_1.it)("acks addon execution mode from object tree", async () => {
        const store = new Map();
        const adapter = {
            namespace: "ems.0",
            log: { info: () => { }, warn: () => { } },
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
        };
        await (0, execution_mode_js_1.handleExecutionModeStateChange)(adapter, "ems.0.addons.immersion_heater.mode", {
            val: "live",
            ack: false,
        });
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.val, "live");
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.ack, true);
    });
    (0, node_test_1.it)("syncExecutionModesFromConfig preserves existing runtime modes on restart", async () => {
        const store = new Map([
            ["global.execution_mode", { val: "live", ack: true }],
            ["addons.immersion_heater.mode", { val: "live", ack: true }],
            ["addons.battery.mode", { val: "dryrun", ack: true }],
        ]);
        const host = {
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
        };
        await (0, execution_mode_js_1.syncExecutionModesFromConfig)(host, {
            global_execution_mode: "dryrun",
            ih_addon_mode: "dryrun",
            bat_addon_mode: "live",
        });
        strict_1.default.equal(store.get("global.execution_mode")?.val, "live");
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.val, "live");
        strict_1.default.equal(store.get("addons.battery.mode")?.val, "dryrun");
        strict_1.default.equal(store.get("execution.safety.global_execution_mode")?.val, "live");
    });
    (0, node_test_1.it)("syncExecutionModesFromConfig seeds empty states from admin config", async () => {
        const store = new Map();
        const host = {
            getStateAsync: async (id) => store.get(id) ?? null,
            setStateAsync: async (id, st) => {
                store.set(id, { val: st.val, ack: st.ack ?? false });
            },
            setObjectNotExistsAsync: async () => undefined,
        };
        await (0, execution_mode_js_1.syncExecutionModesFromConfig)(host, {
            global_execution_mode: "live",
            ih_addon_mode: "live",
            bat_addon_mode: "dryrun",
            wb_addon_mode: "dryrun",
        });
        strict_1.default.equal(store.get("global.execution_mode")?.val, "live");
        strict_1.default.equal(store.get("addons.immersion_heater.mode")?.val, "live");
        strict_1.default.equal(store.get("addons.battery.mode")?.val, "dryrun");
    });
});

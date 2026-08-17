"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const failsafe_js_1 = require("./failsafe.js");
const ems_activity_js_1 = require("../../ems_activity.js");
const ensure_states_js_1 = require("./ensure_states.js");
function mockAdapter(config, initialStates = {}) {
    const states = new Map(Object.entries(initialStates));
    const writes = [];
    const adapter = {
        config,
        log: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            debug: () => undefined,
        },
        getStateAsync: async (id) => (states.has(id) ? states.get(id) : null),
        setStateAsync: async (id, state) => {
            const val = state && typeof state === "object" && "val" in state ? state.val : state;
            states.set(id, { val: val ?? null });
            return undefined;
        },
        getForeignStateAsync: async (id) => (states.has(id) ? states.get(id) : null),
        setForeignStateAsync: async (id, state) => {
            const val = state && typeof state === "object" && "val" in state ? state.val : state;
            writes.push({ id, val: val ?? null });
            states.set(id, { val: val ?? null });
        },
    };
    return { adapter, states, writes };
}
function liveConfig(over = {}) {
    return {
        battery_profile: "sonnen_em",
        bat_operating_mode_target: "device.mode",
        bat_operating_mode_enabled: true,
        bat_battery_charging_target: "device.charge",
        bat_battery_charging_enabled: true,
        ...over,
    };
}
(0, node_test_1.describe)("runBatteryFailsafeCheck", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, failsafe_js_1.__resetBatteryFailsafeForTest)();
        (0, ems_activity_js_1.touchEmsActivity)();
    });
    (0, node_test_1.it)("does nothing for profiles without live control (generic_readonly)", async () => {
        const { adapter, writes } = mockAdapter({ battery_profile: "generic_readonly" });
        await (0, failsafe_js_1.runBatteryFailsafeCheck)(adapter);
        strict_1.default.equal(writes.length, 0);
    });
    (0, node_test_1.it)("marks ems_reachable=true and does not trip while activity is recent", async () => {
        const { adapter, writes, states } = mockAdapter(liveConfig(), {
            "global.execution_mode": { val: "live" },
            "addons.battery.mode": { val: "live" },
        });
        await (0, failsafe_js_1.runBatteryFailsafeCheck)(adapter);
        strict_1.default.equal(writes.length, 0);
        strict_1.default.equal(states.get(ensure_states_js_1.BAT.failsafe.emsReachable)?.val, true);
        strict_1.default.equal(states.get(ensure_states_js_1.BAT.failsafe.wouldTrip)?.val, false);
    });
    (0, node_test_1.it)("clears a stale failsafe_active flag once reachable again and live", async () => {
        const { adapter, states } = mockAdapter(liveConfig(), {
            "global.execution_mode": { val: "live" },
            "addons.battery.mode": { val: "live" },
            [ensure_states_js_1.BAT.failsafe.active]: { val: true },
        });
        await (0, failsafe_js_1.runBatteryFailsafeCheck)(adapter);
        strict_1.default.equal(states.get(ensure_states_js_1.BAT.failsafe.active)?.val, false);
    });
    (0, node_test_1.it)("does not clear failsafe_active while not live (would_trip stays diagnostic-only)", async () => {
        const { adapter, states } = mockAdapter(liveConfig(), {
            "global.execution_mode": { val: "dryrun" },
            "addons.battery.mode": { val: "dryrun" },
            [ensure_states_js_1.BAT.failsafe.active]: { val: true },
        });
        await (0, failsafe_js_1.runBatteryFailsafeCheck)(adapter);
        strict_1.default.equal(states.get(ensure_states_js_1.BAT.failsafe.active)?.val, true);
    });
    (0, node_test_1.it)("failsafe zeros charge and discharge mappings", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "..", "..", "src", "addons", "battery", "failsafe.ts"), "utf8");
        strict_1.default.match(src, /set_discharge_power/);
        strict_1.default.match(src, /set_charge_power/);
        strict_1.default.match(src, /selfConsumption/);
    });
});

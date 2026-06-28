"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
const ensure_states_js_1 = require("./ensure_states.js");
const DEVICE_TARGETS = new Set(["dev.mode", "dev.charge"]);
const CONFIG = {
    battery_profile: "sonnen_em",
    bat_hw_max_charge_w: 5000,
    bat_hw_max_discharge_w: 5000,
    bat_hw_min_soc_pct: 5,
    bat_hw_max_soc_pct: 100,
    bat_mode_pause_grid_balance_sec: 0,
    bat_mode_wait_after_mode_sec: 0,
    bat_feedback_timeout_mode_sec: 5,
    bat_feedback_timeout_charge_sec: 5,
    bat_soc_target: "dev.soc",
    bat_power_target: "dev.power",
    bat_operating_mode_target: "dev.mode",
    bat_battery_charging_target: "dev.charge",
    battery_capacity_source: "manual",
    battery_capacity_net_kwh: 10,
};
class MockAdapter {
    rel = new Map();
    foreign = new Map();
    foreignWrites = [];
    namespace = "ems.0";
    config;
    log = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        silly: () => undefined,
        level: "info",
    };
    constructor(config) {
        this.config = config;
    }
    async getStateAsync(id) {
        return this.rel.has(id) ? { val: this.rel.get(id) ?? null, ack: true } : null;
    }
    async setStateAsync(id, st) {
        this.rel.set(id, st.val ?? null);
    }
    async getForeignStateAsync(id) {
        return this.foreign.has(id)
            ? { val: this.foreign.get(id) ?? null, ack: true, ts: Date.now() }
            : null;
    }
    async setForeignStateAsync(id, st) {
        const val = st.val ?? null;
        this.foreignWrites.push({ id, val });
        this.foreign.set(id, val);
    }
}
function setupCharge(global, govEnabled = true) {
    const a = new MockAdapter(CONFIG);
    a.rel.set("global.execution_mode", global);
    a.rel.set("addons.battery.governance.enabled", govEnabled);
    a.rel.set("ems_mirror.battery_intent_active", true);
    a.rel.set("ems_mirror.operating_mode_target", 1);
    a.rel.set("ems_mirror.charge_power_w_request", 2000);
    a.rel.set("ems_mirror.mode_request_id", 1);
    a.foreign.set("dev.soc", 50);
    a.foreign.set("dev.power", 0);
    a.foreign.set("dev.mode", 2);
    return a;
}
async function runTicks(a, n, simulateDevice) {
    for (let i = 0; i < n; i++) {
        await (0, index_js_1.runBatteryControlTick)(a);
        if (simulateDevice) {
            // Simulate the device reacting to live writes (charge target → power telemetry).
            if (a.foreign.has("dev.charge")) {
                a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
            }
        }
    }
}
(0, node_test_1.describe)("battery control tick — dryrun", () => {
    (0, node_test_1.it)("never writes to device datapoints under global dryrun", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("dryrun");
        await runTicks(a, 14, false);
        const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(deviceWrites.length, 0);
    });
    (0, node_test_1.it)("mirrors dryrun intent and reaches active state via simulated feedback", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("dryrun");
        await runTicks(a, 14, false);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.dryrun.requestedAction), "charge");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.dryrun.effectivePowerW), 2000);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.status.effectiveExecutionMode), "dryrun");
        // Telemetry still mirrored.
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.telemetry.socPct), 50);
    });
});
(0, node_test_1.describe)("battery control tick — live", () => {
    (0, node_test_1.it)("writes mode then charge in order through central function", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live");
        await runTicks(a, 14, true);
        const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.ok(deviceWrites.length >= 2);
        strict_1.default.equal(deviceWrites[0].id, "dev.mode");
        strict_1.default.equal(deviceWrites[0].val, 1);
        const firstCharge = deviceWrites.find((w) => w.id === "dev.charge");
        strict_1.default.equal(firstCharge?.val, 2000);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
    });
    (0, node_test_1.it)("battery disabled by governance → no device writes, telemetry still read", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", false);
        await runTicks(a, 14, true);
        const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(deviceWrites.length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.telemetry.socPct), 50);
    });
});

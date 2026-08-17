"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
const ensure_states_js_1 = require("./ensure_states.js");
const setpoint_session_js_1 = require("./runtime/setpoint_session.js");
const ensure_states_js_2 = require("../wallbox/ev_foundation/ensure_states.js");
const ensure_evcc_states_js_1 = require("../wallbox/ensure_evcc_states.js");
const states_js_1 = require("../wallbox/runtime/states.js");
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
    bat_charging_power_target: "dev.charge",
    battery_capacity_source: "manual",
    battery_capacity_net_kwh: 10,
};
class MockAdapter {
    rel = new Map();
    relTs = new Map();
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
        if (!this.rel.has(id))
            return null;
        return {
            val: this.rel.get(id) ?? null,
            ack: true,
            ts: this.relTs.get(id) ?? Date.now(),
        };
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
function setupCharge(global, govEnabled = true, addonMode = global) {
    const a = new MockAdapter(CONFIG);
    a.rel.set("global.execution_mode", global);
    a.rel.set("addons.battery.mode", addonMode);
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
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.action), "charge");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointW), 2000);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.status.effectiveExecutionMode), "dryrun");
        // Telemetry still mirrored.
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.telemetry.socPct), 50);
    });
});
(0, node_test_1.describe)("battery control tick — live", () => {
    (0, node_test_1.it)("writes mode then charge in order through central function", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
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
    (0, node_test_1.it)("global live but addon dryrun → no device writes", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "dryrun");
        await runTicks(a, 14, true);
        const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(deviceWrites.length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.status.effectiveExecutionMode), "dryrun");
    });
    (0, node_test_1.it)("dryrun progress discarded when live write becomes allowed", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("dryrun", true, "dryrun");
        await runTicks(a, 14, false);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        a.rel.set("global.execution_mode", "live");
        a.rel.set("addons.battery.mode", "live");
        await runTicks(a, 14, true);
        const modeWrites = a.foreignWrites.filter((w) => w.id === "dev.mode");
        strict_1.default.ok(modeWrites.length >= 1);
        strict_1.default.equal(modeWrites[0].val, 1);
    });
});
(0, node_test_1.describe)("battery control tick — LIVE → OFF ownership handover", () => {
    (0, node_test_1.it)("live ownership → off: one restore cycle, then 0 further device writes", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        await runTicks(a, 14, true);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive), true);
        const writesBeforeOff = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id)).length;
        a.rel.set("addons.battery.mode", "off");
        // Drive restore: charge→0, mode→self-consumption (2)
        for (let i = 0; i < 20; i++) {
            await (0, index_js_1.runBatteryControlTick)(a);
            if (a.foreign.has("dev.charge")) {
                a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
            }
            if (a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive) !== true)
                break;
        }
        const restoreWrites = a.foreignWrites.slice(writesBeforeOff).filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.ok(restoreWrites.length >= 1, "restore must write at least charge stop / mode");
        strict_1.default.ok(restoreWrites.some((w) => w.id === "dev.charge" && w.val === 0) ||
            restoreWrites.some((w) => w.id === "dev.mode" && w.val === 2), "restore cycle must stop charge or set self-consumption");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive), false);
        const afterRestore = a.foreignWrites.length;
        await runTicks(a, 10, true);
        const further = a.foreignWrites.slice(afterRestore).filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(further.length, 0, "after OFF handover: no further battery device writes");
    });
    (0, node_test_1.it)("off without ownership → 0 device writes", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "off");
        a.rel.set("ems_mirror.battery_intent_active", true);
        await runTicks(a, 14, true);
        const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(deviceWrites.length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive), false);
    });
});
(0, node_test_1.describe)("battery setpoint release safety", () => {
    (0, node_test_1.it)("regular end after own >0 write: exactly one 0 W, diagnosis cleared", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        await runTicks(a, 14, true);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "planned_charge");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointW), 2000);
        const before = a.foreignWrites.length;
        a.rel.set("ems_mirror.battery_intent_active", false);
        a.rel.set("ems_mirror.operating_mode_target", 2);
        a.rel.set("ems_mirror.charge_power_w_request", 0);
        for (let i = 0; i < 20; i++) {
            await (0, index_js_1.runBatteryControlTick)(a);
            if (a.foreign.has("dev.charge"))
                a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
            if (a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive) !== true)
                break;
        }
        const zeros = a.foreignWrites.slice(before).filter((w) => w.id === "dev.charge" && w.val === 0);
        strict_1.default.equal(zeros.length, 1);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "none");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointW), 0);
        strict_1.default.equal((0, setpoint_session_js_1.getBatterySetpointSession)().releasePending, false);
        strict_1.default.ok(String((0, setpoint_session_js_1.getBatterySetpointSession)().lastReleaseAt ?? "").length > 0);
    });
    (0, node_test_1.it)("stale planner Hold constraint does not set hold_detected", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        const staleTs = Date.now() - 16 * 60 * 1000;
        a.rel.set("planner.constraints.battery_hold_active", true);
        a.relTs.set("planner.constraints.battery_hold_active", staleTs);
        a.rel.set("planner.constraints.evcc_battery_hold", true);
        a.relTs.set("planner.constraints.evcc_battery_hold", staleTs);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode, "normal");
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(ensure_states_js_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), false);
    });
    (0, node_test_1.it)("discharge control alone does not set hold_detected (live case)", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("planner.constraints.battery_hold_active", false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl, true);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode, "unknown");
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.charging, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(ensure_states_js_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), false);
    });
    (0, node_test_1.it)("EVCC battery_mode hold sets hold_detected", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("planner.constraints.battery_hold_active", false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl, true);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode, "hold");
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), true);
    });
    (0, node_test_1.it)("EVCC battery_mode holdcharge sets hold_detected", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("planner.constraints.battery_hold_active", false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl, true);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode, "holdcharge");
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), true);
    });
    (0, node_test_1.it)("current EV-charge Hold sets hold_detected", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("planner.constraints.battery_hold_active", false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, true);
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), true);
    });
    (0, node_test_1.it)("leftover EVCC now with disconnected vehicle does not invent EV hold/conflict", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("planner.constraints.battery_hold_active", false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, true);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode, "normal");
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.loadpointMode, "now");
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.charging, false);
        a.rel.set(ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.chargePowerW, 0);
        a.rel.set(states_js_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
        a.rel.set(ensure_states_js_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
        await (0, index_js_1.runBatteryControlTick)(a);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.holdDetected), false);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.gridBalance.evConflict), false);
    });
    (0, node_test_1.it)("grid_charge/hold: no competing 0 W against Hold", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        await runTicks(a, 14, true);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.state), "active");
        const before = a.foreignWrites.length;
        a.rel.set("planner.constraints.battery_hold_active", true);
        for (let i = 0; i < 8; i++) {
            await (0, index_js_1.runBatteryControlTick)(a);
            if (a.foreign.has("dev.charge"))
                a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
        }
        const after = a.foreignWrites.slice(before).filter((w) => DEVICE_TARGETS.has(w.id));
        strict_1.default.equal(after.filter((w) => w.id === "dev.charge" && w.val === 0).length, 0, "Hold takeover must not write 0 W");
        strict_1.default.equal(after.filter((w) => w.id === "dev.mode" && w.val === 2).length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "none");
        strict_1.default.equal(String((0, setpoint_session_js_1.getBatterySetpointSession)().releaseReason), "handover_hold");
    });
    (0, node_test_1.it)("grid_charge/external: no competing 0 W against External", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        await runTicks(a, 14, true);
        const before = a.foreignWrites.length;
        a.rel.set(ensure_states_js_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "external");
        for (let i = 0; i < 8; i++) {
            await (0, index_js_1.runBatteryControlTick)(a);
        }
        const zeros = a.foreignWrites
            .slice(before)
            .filter((w) => w.id === "dev.charge" && w.val === 0);
        strict_1.default.equal(zeros.length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "none");
        strict_1.default.equal(String((0, setpoint_session_js_1.getBatterySetpointSession)().releaseReason), "handover_external");
    });
    (0, node_test_1.it)("Live → Dryrun during live charge: 0 W restore write", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        await runTicks(a, 14, true);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "planned_charge");
        const before = a.foreignWrites.length;
        a.rel.set("global.execution_mode", "dryrun");
        a.rel.set("addons.battery.mode", "dryrun");
        for (let i = 0; i < 20; i++) {
            await (0, index_js_1.runBatteryControlTick)(a);
            if (a.foreign.has("dev.charge"))
                a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
            if (a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive) !== true)
                break;
        }
        const zeros = a.foreignWrites.slice(before).filter((w) => w.id === "dev.charge" && w.val === 0);
        strict_1.default.equal(zeros.length, 1);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "none");
    });
    (0, node_test_1.it)("adapter restart leftover setpoint without ownership: no blind 0 W", async () => {
        (0, index_js_1.__resetBatteryRuntimeForTest)();
        const a = setupCharge("live", true, "live");
        a.rel.set("ems_mirror.battery_intent_active", false);
        a.rel.set("ems_mirror.operating_mode_target", 2);
        a.rel.set("ems_mirror.charge_power_w_request", 0);
        a.foreign.set("dev.charge", 2000);
        a.foreign.set("dev.power", 0);
        a.foreign.set("dev.mode", 2);
        await runTicks(a, 8, true);
        const zeros = a.foreignWrites.filter((w) => w.id === "dev.charge" && w.val === 0);
        strict_1.default.equal(zeros.length, 0);
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.batterySetpointOwner), "none");
        strict_1.default.equal(a.rel.get(ensure_states_js_1.BAT.runtime.ownershipActive), false);
    });
});

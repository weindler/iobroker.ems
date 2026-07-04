"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlannerThermalStage = exports.readPlannerInputs = exports.PLANNER_BATTERY_MIN_SURPLUS_W = exports.PLANNER_BATTERY_TARGET_SOC_PCT = exports.PLANNER_SURPLUS_MIN_W = void 0;
const device_config_1 = require("../addons/immersion_heater/device_config");
const intent_read_1 = require("../addons/immersion_heater/runtime/intent_read");
const ensure_evcc_states_1 = require("../addons/wallbox/ensure_evcc_states");
const governance_1 = require("../addons/governance");
const intent_read_2 = require("../addons/battery/runtime/intent_read");
const state_util_1 = require("../ems_light/state_util");
exports.PLANNER_SURPLUS_MIN_W = 400;
exports.PLANNER_BATTERY_TARGET_SOC_PCT = 95;
exports.PLANNER_BATTERY_MIN_SURPLUS_W = 500;
async function readNum(host, id) {
    try {
        const st = await host.getStateAsync(id);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val == null || String(st.val).trim() === "")
            return null;
        return String(st.val).trim();
    }
    catch {
        return null;
    }
}
async function readBool(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val == null)
            return null;
        if (typeof st.val === "boolean")
            return st.val;
        const s = String(st.val).trim().toLowerCase();
        if (s === "true" || s === "1")
            return true;
        if (s === "false" || s === "0")
            return false;
        return null;
    }
    catch {
        return null;
    }
}
async function readPlannerInputs(host) {
    const now = new Date();
    const pvFromPv = await readNum(host, "live.pv.power_w");
    const pvFromBattery = await readNum(host, "live.battery.pv_ac_power_w");
    const pvPowerW = pvFromPv ?? pvFromBattery;
    const thermalRaw = await host.getStateAsync("user_intent.thermal.resolved_json");
    const thermalIntent = (0, intent_read_1.parseResolvedIntentJson)(thermalRaw?.val);
    const thermalMode = (0, intent_read_1.resolvedModeFromIntent)(thermalIntent);
    const batteryRaw = await host.getStateAsync("user_intent.battery.resolved_json");
    const batteryIntent = (0, intent_read_2.parseResolvedBatteryIntentJson)(batteryRaw?.val);
    const userIntentBatteryHold = batteryIntent?.operating_request.status === "valid" &&
        batteryIntent.operating_request.value === "hold";
    const [thermalGov, batteryGov, houseLoadW, socPct, bufferTempC, evccMode, evccDischarge] = await Promise.all([
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "immersion_heater"),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "battery"),
        readNum(host, "live.battery.house_load_w"),
        readNum(host, "live.battery.soc_pct"),
        readNum(host, "live.thermal.buffer_temp_c"),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl),
    ]);
    return {
        now,
        pvPowerW,
        houseLoadW,
        socPct,
        bufferTempC,
        thermalMode,
        thermalGovernanceEnabled: thermalGov,
        batteryGovernanceEnabled: batteryGov,
        evccBatteryMode: evccMode,
        evccBatteryDischargeControl: evccDischarge,
        userIntentBatteryHold,
        immersionConfig: (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config),
    };
}
exports.readPlannerInputs = readPlannerInputs;
async function readPlannerThermalStage(host) {
    const n = await readNum(host, "planner.intent.thermal.commanded_stage");
    if (n === null || !Number.isFinite(n))
        return 0;
    return Math.max(0, Math.round(n));
}
exports.readPlannerThermalStage = readPlannerThermalStage;

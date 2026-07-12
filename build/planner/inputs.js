"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlannerThermalTargetTemp = exports.readPlannerThermalStage = exports.readPlannerInputs = exports.PLANNER_BATTERY_MIN_SURPLUS_W = exports.PLANNER_BATTERY_TARGET_SOC_PCT = exports.PLANNER_SURPLUS_MIN_W = void 0;
const config_1 = require("../addons/air_conditioning/config");
const constants_1 = require("../addons/air_conditioning/constants");
const ensure_states_1 = require("../addons/air_conditioning/runtime/ensure_states");
const governance_1 = require("../addons/governance");
const device_config_1 = require("../addons/immersion_heater/device_config");
const intent_read_1 = require("../addons/immersion_heater/runtime/intent_read");
const ensure_evcc_states_1 = require("../addons/wallbox/ensure_evcc_states");
const ensure_states_2 = require("../addons/governance/ensure_states");
const battery_winter_price_inputs_1 = require("./battery_winter_price_inputs");
const battery_winter_config_1 = require("./battery_winter_config");
const battery_winter_inputs_1 = require("./battery_winter_inputs");
const intent_read_2 = require("../addons/battery/runtime/intent_read");
const persist_1 = require("../learning/consumer_stats/persist");
const consumer_stats_1 = require("../learning/consumer_stats");
const config_2 = require("../learning/weather/config");
const state_util_1 = require("../ems_light/state_util");
const mode_policy_1 = require("./mode_policy");
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
async function readConsumerStatsForPlanner(host) {
    const dir = host.getAbsolutePath?.(consumer_stats_1.PERSIST_CATEGORY);
    if (!dir) {
        return null;
    }
    try {
        return await (0, persist_1.readConsumerStatsPersist)(dir);
    }
    catch {
        return null;
    }
}
async function readOutdoorTempC(host) {
    const weather = (0, config_2.weatherConfigFromAdapter)(host.config);
    const tempMetric = weather.metrics.temp;
    if (!tempMetric) {
        return null;
    }
    const actual = await readNum(host, tempMetric.actualStateId);
    if (actual !== null) {
        return actual;
    }
    return readNum(host, tempMetric.forecastStateId);
}
async function readCoolingUnitInputs(host, acConfig, persist) {
    const rows = [];
    for (const unit of acConfig.units) {
        if (!unit.enabled) {
            continue;
        }
        const roomTempC = await readNum(host, `${(0, ensure_states_1.acUnitRuntimeBase)(unit.index)}.room_temp_c`);
        const consumerKey = (0, constants_1.acUnitConsumerKey)(unit.index);
        rows.push({
            unit,
            roomTempC,
            consumerStats: persist?.consumers[consumerKey],
        });
    }
    return rows;
}
async function readPlannerInputs(host, options) {
    const now = new Date();
    const acConfig = (0, config_1.acGlobalConfigFromAdapter)(host.config);
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
    const userIntentBatteryCharge = batteryIntent?.operating_request.status === "valid" &&
        batteryIntent.operating_request.value === "charge";
    const globalModeRaw = await readStr(host, "global_modes.active");
    const modePolicy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(globalModeRaw);
    const immersionConfig = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const consumerStatsPersist = await readConsumerStatsForPlanner(host);
    const batteryWinterConfig = (0, battery_winter_config_1.batteryWinterPlanConfigFromAdapter)(host.config);
    const [thermalGov, batteryGov, coolingGov, houseLoadW, socPct, bufferTempC, evccMode, evccDischarge, pvTodayKwh, pvTomorrowKwh, pvBiasStatus, aiThermalAllowed, batteryAiAllowed, snowCover, outdoorTempC, coolingUnits, batteryWinterDays, batteryWinterPriceSlots] = await Promise.all([
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "immersion_heater"),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "battery"),
        (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "climate"),
        readNum(host, "live.battery.house_load_w"),
        readNum(host, "live.battery.soc_pct"),
        readNum(host, "live.thermal.buffer_temp_c"),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl),
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readStr(host, "learning.pv_bias.status"),
        readBool(host, (0, ensure_states_2.addonGovernanceAiAllowedState)("immersion_heater")),
        readBool(host, (0, ensure_states_2.addonGovernanceAiAllowedState)("battery")),
        readBool(host, "ems_mirror.snow_cover_suspected"),
        readOutdoorTempC(host),
        readCoolingUnitInputs(host, acConfig, consumerStatsPersist),
        (0, battery_winter_inputs_1.readBatteryWinterDays)(host, batteryWinterConfig.horizonDays),
        options?.batteryWinterPriceSlots ?? (0, battery_winter_price_inputs_1.readTibber15MinPriceSlots)(host, now),
    ]);
    return {
        now,
        globalMode: modePolicy.mode,
        modePolicy,
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
        userIntentBatteryCharge,
        immersionConfig,
        pvTodayKwh,
        pvTomorrowKwh,
        pvBiasStatus,
        forecastModeEnabled: immersionConfig.forecastModeEnabled,
        aiOptimizationAllowed: aiThermalAllowed === true,
        acConfig,
        coolingGovernanceEnabled: coolingGov,
        outdoorTempC,
        coolingUnits,
        batteryWinterConfig,
        batteryWinterDays,
        snowCoverSuspected: snowCover === true,
        batteryAiAllowed: batteryAiAllowed === true,
        batteryWinterPriceSlots,
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
async function readPlannerThermalTargetTemp(host) {
    return readNum(host, "planner.intent.thermal.target_temp_c");
}
exports.readPlannerThermalTargetTemp = readPlannerThermalTargetTemp;

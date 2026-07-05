"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlannerTick = exports.runPlanner = exports.resetPlannerRevisionForTest = void 0;
const state_write_1 = require("../policy/core/state_write");
const inputs_1 = require("./inputs");
const battery_1 = require("./rules/battery");
const battery_winter_1 = require("./rules/battery_winter");
const surplus_1 = require("./rules/surplus");
const thermal_1 = require("./rules/thermal");
const cooling_1 = require("./rules/cooling");
const types_1 = require("./types");
let revision = 0;
function resetPlannerRevisionForTest() {
    revision = 0;
}
exports.resetPlannerRevisionForTest = resetPlannerRevisionForTest;
function runPlanner(inputs) {
    const surplusW = (0, surplus_1.computePvSurplusW)(inputs.pvPowerW, inputs.houseLoadW);
    const deficitW = (0, battery_1.computeDeficitW)(inputs.pvPowerW, inputs.houseLoadW);
    const constraints = (0, battery_1.buildPlannerConstraints)({
        evccBatteryMode: inputs.evccBatteryMode,
        evccBatteryDischargeControl: inputs.evccBatteryDischargeControl,
        userIntentBatteryHold: inputs.userIntentBatteryHold,
    });
    const thermal = (0, thermal_1.planThermal)({
        surplusW,
        bufferTempC: inputs.bufferTempC,
        thermalMode: inputs.thermalMode,
        governanceEnabled: inputs.thermalGovernanceEnabled,
        config: inputs.immersionConfig,
        modePolicy: inputs.modePolicy,
        pvTodayKwh: inputs.pvTodayKwh,
        pvTomorrowKwh: inputs.pvTomorrowKwh,
        pvBiasStatus: inputs.pvBiasStatus,
        forecastModeEnabled: inputs.forecastModeEnabled,
        aiOptimizationAllowed: inputs.aiOptimizationAllowed,
    });
    const thermalAllocatedW = thermal.commanded_stage > 0 ? thermal.commanded_power_w : 0;
    const coolingFull = (0, cooling_1.planCooling)({
        now: inputs.now,
        acConfig: inputs.acConfig,
        governanceEnabled: inputs.coolingGovernanceEnabled,
        outdoorTempC: inputs.outdoorTempC,
        units: inputs.coolingUnits,
    });
    const cooling = {
        expected_kwh_today: coolingFull.expected_kwh_today,
        expected_peak_w: coolingFull.expected_peak_w,
        likely_active: coolingFull.likely_active,
        reason_de: coolingFull.reason_de,
        forecast_active: coolingFull.forecast_active,
    };
    const consumerAllocatedW = thermalAllocatedW + (0, cooling_1.coolingReserveW)(cooling);
    const battery = (0, battery_1.planBattery)({
        surplusW,
        deficitW,
        socPct: inputs.socPct,
        governanceEnabled: inputs.batteryGovernanceEnabled,
        constraints,
        consumerAllocatedW,
        modePolicy: inputs.modePolicy,
    });
    const batteryWinterRaw = (0, battery_winter_1.planBatteryWinter)({
        now: inputs.now,
        socPct: inputs.socPct,
        snowCoverSuspected: inputs.snowCoverSuspected,
        config: inputs.batteryWinterConfig,
        modePolicy: inputs.modePolicy,
        batteryGovernanceEnabled: inputs.batteryGovernanceEnabled,
        batteryAiAllowed: inputs.batteryAiAllowed,
        days: inputs.batteryWinterDays,
    });
    const battery_winter = {
        active: batteryWinterRaw.active,
        forecast_active: batteryWinterRaw.forecast_active,
        horizon_days: batteryWinterRaw.horizon_days,
        bridge_until_iso: batteryWinterRaw.bridge_until_iso,
        pv_recovery_day: batteryWinterRaw.pv_recovery_day,
        energy_stored_kwh: batteryWinterRaw.energy_stored_kwh,
        energy_deficit_kwh: batteryWinterRaw.energy_deficit_kwh,
        energy_reserve_kwh: batteryWinterRaw.energy_reserve_kwh,
        energy_target_kwh: batteryWinterRaw.energy_target_kwh,
        soc_target_pct: batteryWinterRaw.soc_target_pct,
        charge_energy_kwh: batteryWinterRaw.charge_energy_kwh,
        charge_duration_h: batteryWinterRaw.charge_duration_h,
        charge_slots_15m: batteryWinterRaw.charge_slots_15m,
        confidence_min_pct: batteryWinterRaw.confidence_min_pct,
        windows_json: JSON.stringify(batteryWinterRaw.windows),
        reason_de: batteryWinterRaw.reason_de,
    };
    revision += 1;
    const reasonParts = [
        `Global Mode ${inputs.globalMode}`,
        inputs.modePolicy.labelDe,
    ];
    if (surplusW !== null && surplusW > 0) {
        reasonParts.push(`PV-Überschuss ${surplusW} W`);
    }
    if (deficitW !== null && deficitW > 0) {
        reasonParts.push(`PV-Unterdeckung ${deficitW} W`);
    }
    if (thermal.commanded_stage > 0) {
        reasonParts.push(`Heizstab Stufe ${thermal.commanded_stage}`);
    }
    else if (thermal.forecast_active && inputs.bufferTempC !== null && inputs.bufferTempC >= thermal.target_temp_c) {
        reasonParts.push(`Heizstab Tagesziel ${thermal.target_temp_c} °C erreicht`);
    }
    if (cooling.likely_active) {
        reasonParts.push(`Klima ~${cooling.expected_kwh_today} kWh (Peak ${cooling.expected_peak_w} W)`);
    }
    if (battery.action === "charge") {
        reasonParts.push(`Batterie +${battery.max_charge_w} W`);
    }
    else if (battery.action === "self_consumption") {
        reasonParts.push("Batterie Eigenverbrauch");
    }
    else if (battery.action === "hold") {
        reasonParts.push("Batterie Hold");
    }
    if (constraints.battery_hold_active) {
        reasonParts.push("Hold-Sperre aktiv");
    }
    if (batteryWinterRaw.forecast_active) {
        reasonParts.push(`Winter-Netz: ${batteryWinterRaw.soc_target_pct ?? "—"} % Ziel`);
    }
    return {
        schema_version: 1,
        revision,
        resolved_at: inputs.now.toISOString(),
        reason_de: reasonParts.join(". ") + ".",
        global_mode: {
            active: inputs.globalMode,
            policy_label_de: inputs.modePolicy.labelDe,
        },
        surplus_w: surplusW,
        deficit_w: deficitW,
        pv_power_w: inputs.pvPowerW,
        house_load_w: inputs.houseLoadW,
        constraints,
        thermal,
        cooling,
        battery,
        battery_winter,
    };
}
exports.runPlanner = runPlanner;
function formatBriefing(intent) {
    const lines = [
        `Planner v${types_1.PLANNER_ENGINE_VERSION}. Mode: ${intent.global_mode.active}.`,
        intent.reason_de,
    ];
    if (intent.thermal.commanded_stage > 0) {
        lines.push(intent.thermal.reason_de);
    }
    else if (intent.thermal.forecast_active && intent.thermal.target_reason_de) {
        lines.push(`Heizstab-Ziel ${intent.thermal.target_temp_c} °C: ${intent.thermal.target_reason_de}`);
    }
    else if (intent.thermal.reason_de &&
        !intent.thermal.reason_de.startsWith("Heizstab-Modus")) {
        lines.push(`Heizstab: ${intent.thermal.reason_de}`);
    }
    if (intent.battery.action === "charge" || intent.battery.action === "self_consumption") {
        lines.push(intent.battery.reason_de);
    }
    else if (intent.battery.action === "hold" || intent.constraints.battery_hold_active) {
        lines.push(intent.battery.reason_de);
    }
    if (intent.battery_winter.forecast_active) {
        lines.push(`Winter-Netz: ${intent.battery_winter.reason_de}`);
    }
    if (intent.cooling.likely_active) {
        lines.push(`Klima: ${intent.cooling.reason_de}`);
    }
    return lines.join(" ").slice(0, 480);
}
async function runPlannerTick(host) {
    const inputs = await (0, inputs_1.readPlannerInputs)(host);
    const intent = runPlanner(inputs);
    try {
        await (0, state_write_1.setStateIfChanged)(host, "planner.status", "ready");
        await (0, state_write_1.setStateIfChanged)(host, "planner.global_mode.active", intent.global_mode.active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.last_run_at", intent.resolved_at);
        await (0, state_write_1.setStateIfChanged)(host, "planner.surplus_w", intent.surplus_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.deficit_w", intent.deficit_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.last_json", JSON.stringify(intent));
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.last_reason_de", intent.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.commanded_stage", intent.thermal.commanded_stage);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.commanded_power_w", intent.thermal.commanded_power_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.reason_de", intent.thermal.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.target_temp_c", intent.thermal.target_temp_c);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.target_reason_de", intent.thermal.target_reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.forecast_active", intent.thermal.forecast_active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.cooling.expected_kwh_today", intent.cooling.expected_kwh_today);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.cooling.expected_peak_w", intent.cooling.expected_peak_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.cooling.likely_active", intent.cooling.likely_active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.cooling.reason_de", intent.cooling.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.cooling.forecast_active", intent.cooling.forecast_active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.action", intent.battery.action);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.max_charge_w", intent.battery.max_charge_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.reason_de", intent.battery.reason_de);
        const w = intent.battery_winter;
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.active", w.active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.forecast_active", w.forecast_active);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.horizon_days", w.horizon_days);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.bridge_until_iso", w.bridge_until_iso ?? "");
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.pv_recovery_day", w.pv_recovery_day ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.energy_stored_kwh", w.energy_stored_kwh ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.energy_deficit_kwh", w.energy_deficit_kwh ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.energy_reserve_kwh", w.energy_reserve_kwh ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.energy_target_kwh", w.energy_target_kwh ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.soc_target_pct", w.soc_target_pct ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.charge_energy_kwh", w.charge_energy_kwh ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.charge_duration_h", w.charge_duration_h ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.charge_slots_15m", w.charge_slots_15m ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.confidence_min_pct", w.confidence_min_pct ?? -1);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.windows_json", w.windows_json);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.winter.reason_de", w.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.constraints.evcc_battery_hold", intent.constraints.evcc_battery_hold);
        await (0, state_write_1.setStateIfChanged)(host, "planner.constraints.battery_hold_active", intent.constraints.battery_hold_active);
        await (0, state_write_1.setStateIfChanged)(host, "operator.briefing_de", formatBriefing(intent));
    }
    catch (e) {
        host.log?.warn?.(`planner state write: ${String(e)}`);
    }
    return intent;
}
exports.runPlannerTick = runPlannerTick;

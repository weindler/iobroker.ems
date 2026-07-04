"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlannerTick = exports.runPlanner = exports.resetPlannerRevisionForTest = void 0;
const state_write_1 = require("../policy/core/state_write");
const inputs_1 = require("./inputs");
const battery_1 = require("./rules/battery");
const surplus_1 = require("./rules/surplus");
const thermal_1 = require("./rules/thermal");
const types_1 = require("./types");
let revision = 0;
function resetPlannerRevisionForTest() {
    revision = 0;
}
exports.resetPlannerRevisionForTest = resetPlannerRevisionForTest;
function runPlanner(inputs) {
    const surplusW = (0, surplus_1.computePvSurplusW)(inputs.pvPowerW, inputs.houseLoadW);
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
    });
    const thermalAllocatedW = thermal.commanded_stage > 0 ? thermal.commanded_power_w : 0;
    const battery = (0, battery_1.planBattery)({
        surplusW,
        socPct: inputs.socPct,
        governanceEnabled: inputs.batteryGovernanceEnabled,
        constraints,
        thermalAllocatedW,
    });
    revision += 1;
    const reasonParts = [];
    if (surplusW !== null) {
        reasonParts.push(`PV-Überschuss ${surplusW} W`);
    }
    else {
        reasonParts.push("PV-Überschuss unbekannt");
    }
    if (thermal.commanded_stage > 0) {
        reasonParts.push(`Heizstab Stufe ${thermal.commanded_stage}`);
    }
    if (battery.action === "charge") {
        reasonParts.push(`Batterie +${battery.max_charge_w} W`);
    }
    if (constraints.evcc_battery_hold) {
        reasonParts.push("EVCC-Hold aktiv");
    }
    return {
        schema_version: 1,
        revision,
        resolved_at: inputs.now.toISOString(),
        reason_de: reasonParts.join(". ") + ".",
        surplus_w: surplusW,
        pv_power_w: inputs.pvPowerW,
        house_load_w: inputs.houseLoadW,
        constraints,
        thermal,
        battery,
    };
}
exports.runPlanner = runPlanner;
function formatBriefing(intent) {
    const lines = [
        `Planner v${types_1.PLANNER_ENGINE_VERSION} (dryrun-tauglich).`,
        intent.reason_de,
    ];
    if (intent.thermal.commanded_stage > 0) {
        lines.push(intent.thermal.reason_de);
    }
    else if (intent.thermal.reason_de && !intent.thermal.reason_de.startsWith("Heizstab-Modus")) {
        lines.push(`Heizstab: ${intent.thermal.reason_de}`);
    }
    if (intent.battery.action === "charge") {
        lines.push(intent.battery.reason_de);
    }
    else if (intent.constraints.evcc_battery_hold) {
        lines.push(intent.battery.reason_de);
    }
    return lines.join(" ").slice(0, 480);
}
async function runPlannerTick(host) {
    const inputs = await (0, inputs_1.readPlannerInputs)(host);
    const intent = runPlanner(inputs);
    try {
        await (0, state_write_1.setStateIfChanged)(host, "planner.status", "ready");
        await (0, state_write_1.setStateIfChanged)(host, "planner.last_run_at", intent.resolved_at);
        await (0, state_write_1.setStateIfChanged)(host, "planner.surplus_w", intent.surplus_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.last_json", JSON.stringify(intent));
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.last_reason_de", intent.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.commanded_stage", intent.thermal.commanded_stage);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.commanded_power_w", intent.thermal.commanded_power_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.thermal.reason_de", intent.thermal.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.action", intent.battery.action);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.max_charge_w", intent.battery.max_charge_w);
        await (0, state_write_1.setStateIfChanged)(host, "planner.intent.battery.reason_de", intent.battery.reason_de);
        await (0, state_write_1.setStateIfChanged)(host, "planner.constraints.evcc_battery_hold", intent.constraints.evcc_battery_hold);
        await (0, state_write_1.setStateIfChanged)(host, "operator.briefing_de", formatBriefing(intent));
    }
    catch (e) {
        host.log?.warn?.(`planner state write: ${String(e)}`);
    }
    return intent;
}
exports.runPlannerTick = runPlannerTick;

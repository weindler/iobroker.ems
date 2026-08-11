"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODE_STATES = exports.ensureImmersionRuntimeStates = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const types_1 = require("./types");
function strState(id, name, def, write = false, extendCommon) {
    return {
        id,
        common: { name, type: "string", role: "text", read: !write, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
        extendCommon,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def, write = false) {
    return {
        id,
        common: { name, type: "boolean", role: "switch", read: !write, write, def },
        defaultVal: def,
    };
}
const MODE_STATES = ["off", "auto", "force"];
exports.MODE_STATES = MODE_STATES;
async function ensureImmersionRuntimeStates(host) {
    await (0, state_util_1.ensureChannel)(host, types_1.IMMERSION_RUNTIME_BASE, "Heizstab Runtime");
    const defs = [
        boolState(types_1.IMMERSION_RUNTIME_STATES.available, "Heizstab verfügbar", false),
        strState(types_1.IMMERSION_RUNTIME_STATES.state, "Heizstab Runtime-Zustand", "disabled"),
        strState(types_1.IMMERSION_RUNTIME_STATES.requestedMode, "Heizstab angeforderter Modus", "auto", false, true),
        strState(types_1.IMMERSION_RUNTIME_STATES.resolvedMode, "Heizstab aufgelöster Modus", "auto"),
        numState(types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC, "Puffer-Temperatur °C"),
        numState(types_1.IMMERSION_RUNTIME_STATES.boilerTemperatureC, "Boiler-Temperatur °C"),
        numState(types_1.IMMERSION_RUNTIME_STATES.boilerMinTempC, "Boiler Mindesttemperatur °C"),
        strState(types_1.IMMERSION_RUNTIME_STATES.hygieneJson, "Hygiene Persist (JSON)", "{}"),
        strState(types_1.IMMERSION_RUNTIME_STATES.hygieneStatusDe, "Hygiene-Status (DE)", ""),
        strState(types_1.IMMERSION_RUNTIME_STATES.temperatureStatus, "Temperatur-Status", "missing"),
        numState(types_1.IMMERSION_RUNTIME_STATES.planningMinTempC, "Legacy Planungsuntergrenze °C"),
        numState(types_1.IMMERSION_RUNTIME_STATES.planningMaxTempC, "Puffer-Max / Heizstab-Grenze °C"),
        numState(types_1.IMMERSION_RUNTIME_STATES.planTargetTempC, "Plan-Tagesziel °C (autoritativ)"),
        strState(types_1.IMMERSION_RUNTIME_STATES.planTargetReasonDe, "Plan-Tagesziel Begründung (DE)", ""),
        numState(types_1.IMMERSION_RUNTIME_STATES.forecastTargetTempC, "Forecast-Basisziel °C"),
        numState(types_1.IMMERSION_RUNTIME_STATES.forceTargetTempC, "Force-Ziel °C"),
        strState(types_1.IMMERSION_RUNTIME_STATES.forceUntil, "Force bis (ISO)"),
        numState(types_1.IMMERSION_RUNTIME_STATES.commandedStage, "Befohlene Stufe", 0),
        numState(types_1.IMMERSION_RUNTIME_STATES.commandedPowerW, "Befohlene Leistung W", 0),
        numState(types_1.IMMERSION_RUNTIME_STATES.feedbackStage, "Rückgemeldete Stufe", 0),
        numState(types_1.IMMERSION_RUNTIME_STATES.measuredPowerW, "Gemessene Leistung W"),
        strState(types_1.IMMERSION_RUNTIME_STATES.powerVerificationStatus, "Leistungsprüfung", "unavailable"),
        numState(types_1.IMMERSION_RUNTIME_STATES.minRuntimeRemainingSec, "Mindestlaufzeit verbleibend s", 0),
        numState(types_1.IMMERSION_RUNTIME_STATES.minPauseRemainingSec, "Mindestpause verbleibend s", 0),
        strState(types_1.IMMERSION_RUNTIME_STATES.lastSwitchAt, "Letzter Schaltzeitpunkt (ISO)"),
        boolState(types_1.IMMERSION_RUNTIME_STATES.faultActive, "Fault aktiv", false),
        strState(types_1.IMMERSION_RUNTIME_STATES.faultCode, "Fault-Code", "none"),
        strState(types_1.IMMERSION_RUNTIME_STATES.faultSince, "Fault seit (ISO)"),
        strState(types_1.IMMERSION_RUNTIME_STATES.faultMessage, "Fault-Meldung", ""),
        boolState(types_1.IMMERSION_RUNTIME_STATES.faultReset, "Fault Reset", false, true),
        strState(types_1.IMMERSION_RUNTIME_STATES.reason, "Runtime-Grund", ""),
        strState(types_1.IMMERSION_RUNTIME_STATES.snapshotJson, "Runtime Snapshot (JSON)", "{}"),
        strState(types_1.IMMERSION_RUNTIME_STATES.decisionSource, "Entscheidungsquelle", "safe_default"),
        strState(types_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus, "Daily-Plan-Status Runtime", "daily_plan_missing"),
        numState(types_1.IMMERSION_RUNTIME_STATES.dailyPlanRevision, "Daily-Plan-Revision", 0),
        strState(types_1.IMMERSION_RUNTIME_STATES.dailyPlanSlotStart, "Daily-Plan-Slot Start (ISO)"),
        strState(types_1.IMMERSION_RUNTIME_STATES.dailyPlanSlotEnd, "Daily-Plan-Slot Ende (ISO)"),
        numState(types_1.IMMERSION_RUNTIME_STATES.allocatedPowerW, "Daily-Plan Allocation W"),
        numState(types_1.IMMERSION_RUNTIME_STATES.mandatoryAllocatedPowerW, "Daily-Plan Mandatory W"),
        numState(types_1.IMMERSION_RUNTIME_STATES.flexibleAllocatedPowerW, "Daily-Plan Flexible W"),
        strState(types_1.IMMERSION_RUNTIME_STATES.allocationStatus, "Allocation-Status", "unknown"),
        strState(types_1.IMMERSION_RUNTIME_STATES.allocationReasonDe, "Allocation-Begründung (DE)", ""),
        boolState(types_1.IMMERSION_RUNTIME_STATES.autoTargetReached, "Tagesziel erreicht (Hysterese-Flag)", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureImmersionRuntimeStates = ensureImmersionRuntimeStates;

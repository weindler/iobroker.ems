"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxRuntimeStates = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const states_1 = require("./states");
function strState(id, name, def = "") {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def = false) {
    return {
        id,
        common: { name, type: "boolean", role: "switch", read: true, write: false, def },
        defaultVal: def,
    };
}
async function ensureWallboxRuntimeStates(host) {
    await (0, state_util_1.ensureChannel)(host, states_1.WALLBOX_RUNTIME_BASE, "Wallbox Runtime (read-only)");
    const defs = [
        strState(states_1.WALLBOX_RUNTIME_STATES.decisionSource, "Wallbox Entscheidungsquelle", "safe_default"),
        strState(states_1.WALLBOX_RUNTIME_STATES.reasonDe, "Wallbox Runtime Begründung (DE)"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dailyPlanStatus, "Wallbox Daily-Plan-Status", "daily_plan_missing"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.dailyPlanValid, "Wallbox Daily Plan gültig", false),
        numState(states_1.WALLBOX_RUNTIME_STATES.dailyPlanRevision, "Wallbox Daily-Plan-Revision", 0),
        strState(states_1.WALLBOX_RUNTIME_STATES.dailyPlanSlotStart, "Wallbox Daily-Plan-Slot Start (ISO)"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dailyPlanSlotEnd, "Wallbox Daily-Plan-Slot Ende (ISO)"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.connected, "Wallbox Fahrzeug verbunden", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.chargingAllowedByPlan, "Wallbox Ladefreigabe laut Plan", false),
        numState(states_1.WALLBOX_RUNTIME_STATES.allocatedPowerW, "Wallbox Allocation Leistung W"),
        numState(states_1.WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, "Wallbox Allocation Energie kWh"),
        numState(states_1.WALLBOX_RUNTIME_STATES.allocatedPvPowerW, "Wallbox Allocation PV-Leistung W"),
        numState(states_1.WALLBOX_RUNTIME_STATES.allocatedGridPowerW, "Wallbox Allocation Netz-Leistung W"),
        strState(states_1.WALLBOX_RUNTIME_STATES.energySource, "Wallbox Allocation Energiequelle", "none"),
        strState(states_1.WALLBOX_RUNTIME_STATES.deadlineIso, "Wallbox Deadline (ISO)"),
        numState(states_1.WALLBOX_RUNTIME_STATES.remainingEnergyKwh, "Wallbox Restenergie kWh"),
        numState(states_1.WALLBOX_RUNTIME_STATES.plannedEnergyUntilDeadlineKwh, "Wallbox geplante Energie bis Deadline kWh", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.plannedPvEnergyUntilDeadlineKwh, "Wallbox geplante PV-Energie bis Deadline kWh", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.plannedGridEnergyUntilDeadlineKwh, "Wallbox geplante Netz-Energie bis Deadline kWh", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.plannedCostUntilDeadlineCt, "Wallbox geplante Kosten bis Deadline ct"),
        strState(states_1.WALLBOX_RUNTIME_STATES.deadlineReachable, "Wallbox Deadline erreichbar", "unknown"),
        strState(states_1.WALLBOX_RUNTIME_STATES.firstPlannedSlot, "Wallbox erster geplanter Slot (ISO)"),
        strState(states_1.WALLBOX_RUNTIME_STATES.lastPlannedSlot, "Wallbox letzter geplanter Slot (ISO)"),
        numState(states_1.WALLBOX_RUNTIME_STATES.activePlannedSlots, "Wallbox aktive geplante Slots", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.maxPlannedPowerW, "Wallbox max. geplante Leistung W", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.minChargePowerW, "Wallbox technische Mindestladeleistung W"),
        numState(states_1.WALLBOX_RUNTIME_STATES.maxChargePowerW, "Wallbox technische Maximalleistung W"),
        strState(states_1.WALLBOX_RUNTIME_STATES.planExecutionStatus, "Wallbox Plan-/Ist-Status", "unknown"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.externalPlanActive, "Wallbox externer EVCC-Plan aktiv", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.externalPlanTime, "Wallbox externer EVCC-Planzeit (ISO)"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.governanceAllowed, "Wallbox Governance erlaubt", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.runtimeControlAvailable, "Wallbox Runtime-Steuerung verfügbar", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.writeAllowed, "Wallbox Writes erlaubt", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWallboxRuntimeStates = ensureWallboxRuntimeStates;

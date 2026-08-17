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
function boolState(id, name, def = false, write = false) {
    return {
        id,
        common: { name, type: "boolean", role: "switch", read: true, write, def },
        defaultVal: def,
    };
}
/** Lean Wallbox runtime: Betrieb + Kern-Diagnose; Tiefe in detail_json. */
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
        boolState(states_1.WALLBOX_RUNTIME_STATES.writeLiveEligible, "Wallbox Write live-eligible", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.dispatchStatus, "Wallbox Dispatch-Status", "none"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dispatchReasonDe, "Wallbox Dispatch-Begründung (DE)"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dispatchAction, "Wallbox Dispatch-Aktion", "none"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dispatchSource, "Wallbox Dispatch-Quelle", "safe_default"),
        strState(states_1.WALLBOX_RUNTIME_STATES.dispatchValidUntil, "Wallbox Dispatch gültig bis (ISO)"),
        numState(states_1.WALLBOX_RUNTIME_STATES.dispatchDailyPlanRevision, "Wallbox Dispatch Daily-Plan-Revision", 0),
        boolState(states_1.WALLBOX_RUNTIME_STATES.targetEnabled, "Wallbox Ziel Ladefreigabe", false),
        numState(states_1.WALLBOX_RUNTIME_STATES.targetPowerW, "Wallbox Ziel Leistung W", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.targetCurrentA, "Wallbox Ziel Strom A"),
        numState(states_1.WALLBOX_RUNTIME_STATES.targetPhases, "Wallbox Ziel Phasen"),
        strState(states_1.WALLBOX_RUNTIME_STATES.targetEvccMode, "Wallbox Ziel EVCC-Modus"),
        strState(states_1.WALLBOX_RUNTIME_STATES.deadlineStatus, "Wallbox Deadline-Status", "unknown"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.deadlineRisk, "Wallbox Deadline gefährdet", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.controlMappingComplete, "Wallbox Steuer-Mapping vollständig", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.controlMappingMissingJson, "Wallbox fehlende Steuer-Mappings (JSON)", "[]"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.executionAttempted, "Wallbox Geräte-Write versucht", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.executionExecuted, "Wallbox Geräte-Write ausgeführt", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.executionBlockReason, "Wallbox Execution Blockgrund"),
        strState(states_1.WALLBOX_RUNTIME_STATES.writeContractBlockReason, "Wallbox Write Contract Blockgrund"),
        strState(states_1.WALLBOX_RUNTIME_STATES.feedbackStatus, "Wallbox Feedback-Status", "not_required"),
        strState(states_1.WALLBOX_RUNTIME_STATES.feedbackBlockReason, "Wallbox Feedback-Blockgrund"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleId, "Wallbox aktives Fahrzeug ID"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleName, "Wallbox aktives Fahrzeug Name"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleSource, "Wallbox aktives Fahrzeug Quelle", "unknown"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleDetectionStatus, "Wallbox Fahrzeug-Erkennungsstatus", "unknown"),
        numState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleConfidence, "Wallbox Fahrzeug-Erkennungs-Konfidenz", 0),
        boolState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleProfileValid, "Wallbox aktives Fahrzeugprofil gültig", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehiclePlanningCapability, "Wallbox aktive Planungsfähigkeit", "insufficient"),
        numState(states_1.WALLBOX_RUNTIME_STATES.vehicleProfileCount, "Wallbox Fahrzeugprofil Anzahl", 0),
        numState(states_1.WALLBOX_RUNTIME_STATES.vehicleEnabledProfileCount, "Wallbox aktive Fahrzeugprofile Anzahl", 0),
        strState(states_1.WALLBOX_RUNTIME_STATES.vehicleResolutionReason, "Wallbox Fahrzeugauflösung Begründung"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.vehicleProfileResolved, "Wallbox Fahrzeugprofil aufgelöst", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.vehicleActiveForCharging, "Wallbox fahrzeug aktiv für Laden", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.vehicleConnected, "Wallbox Fahrzeug verbunden (Profil)", false),
        numState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocPct, "Wallbox aktiver aufgelöster SOC %"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocSource, "Wallbox aktive SOC-Quelle", "unknown"),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocQuality, "Wallbox aktive SOC-Qualität", "none"),
        numState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleCurrentBatteryEnergyKwh, "Wallbox aktiver Batterieenergieinhalt kWh"),
        numState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleRequiredBatteryEnergyKwh, "Wallbox aktive benötigte Batterieenergie kWh"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleSocEnergyReady, "Wallbox aktiver SOC/Energie bereit", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.activeVehicleSocEnergyReasonCode, "Wallbox aktiver SOC/Energie Reason-Code"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.ownershipActive, "Wallbox EMS-Ownership aktiv", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.faultActive, "Wallbox Fault/Lockout aktiv", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.faultCode, "Wallbox Fault-Code"),
        strState(states_1.WALLBOX_RUNTIME_STATES.faultMessage, "Wallbox Fault-Meldung"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.faultReset, "Wallbox Fault zurücksetzen", false, true),
        strState(states_1.WALLBOX_RUNTIME_STATES.detailJson, "Wallbox Detail-Diagnose (JSON, für Support-Paket)", "{}"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, "Wallbox Hausbatterie-Hold für EV-Laden", false),
        strState(states_1.WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, "Wallbox Batterie-Hold Begründung (DE)"),
        boolState(states_1.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, "Wallbox externes Fahrzeugladen aktiv", false),
        boolState(states_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, "Wallbox Tibber Grid Rewards aktiv", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWallboxRuntimeStates = ensureWallboxRuntimeStates;

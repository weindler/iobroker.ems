"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxEvFoundationStates = exports.WALLBOX_EV_FOUNDATION_STATES = void 0;
const tree_paths_1 = require("../../../tree_paths");
const state_util_1 = require("../../../ems_light/state_util");
const EV_FOUNDATION_BASE = `${(0, tree_paths_1.addonStatusBase)("wallbox")}.ev_foundation`;
exports.WALLBOX_EV_FOUNDATION_STATES = {
    evccReachable: `${EV_FOUNDATION_BASE}.evcc_reachable`,
    vehicleConnected: `${EV_FOUNDATION_BASE}.vehicle_connected`,
    charging: `${EV_FOUNDATION_BASE}.charging`,
    chargePowerW: `${EV_FOUNDATION_BASE}.charge_power_w`,
    evccMode: `${EV_FOUNDATION_BASE}.evcc_mode`,
    phasesConfigured: `${EV_FOUNDATION_BASE}.phases_configured`,
    phasesActive: `${EV_FOUNDATION_BASE}.phases_active`,
    vehicleSocPct: `${EV_FOUNDATION_BASE}.vehicle_soc_pct`,
    vehicleSocQuality: `${EV_FOUNDATION_BASE}.vehicle_soc_quality`,
    capabilitiesJson: `${EV_FOUNDATION_BASE}.capabilities_json`,
    externalControlActive: `${EV_FOUNDATION_BASE}.external_control_active`,
    externalControlType: `${EV_FOUNDATION_BASE}.external_control_type`,
    externalControlConfigured: `${EV_FOUNDATION_BASE}.external_control_configured`,
    gridRewardsActive: `${EV_FOUNDATION_BASE}.grid_rewards_active`,
    smartChargingActive: `${EV_FOUNDATION_BASE}.smart_charging_active`,
    externalSourceQuality: `${EV_FOUNDATION_BASE}.external_source_quality`,
    externalSourceUpdatedAt: `${EV_FOUNDATION_BASE}.external_source_updated_at`,
    externalSmartPlanMappingConfigured: `${EV_FOUNDATION_BASE}.external_smart_plan_mapping_configured`,
    externalSmartPlanParseable: `${EV_FOUNDATION_BASE}.external_smart_plan_parseable`,
    externalSmartPlanAvailable: `${EV_FOUNDATION_BASE}.external_smart_plan_available`,
    externalSmartPlanSlotCount: `${EV_FOUNDATION_BASE}.external_smart_plan_slot_count`,
    externalSmartPlanNextStart: `${EV_FOUNDATION_BASE}.external_smart_plan_next_start`,
    externalSmartPlanLastEnd: `${EV_FOUNDATION_BASE}.external_smart_plan_last_end`,
    externalPlanRemainingEnergyKwh: `${EV_FOUNDATION_BASE}.external_plan_remaining_energy_kwh`,
    externalPlanRemainingMinutes: `${EV_FOUNDATION_BASE}.external_plan_remaining_minutes`,
    externalPlanDeadlineUsed: `${EV_FOUNDATION_BASE}.external_plan_deadline_used`,
    externalSmartPlanJson: `${EV_FOUNDATION_BASE}.external_smart_plan_json`,
    externalRawDiagnosticsJson: `${EV_FOUNDATION_BASE}.external_raw_diagnostics_json`,
    preparedEvState: `${EV_FOUNDATION_BASE}.prepared_ev_state`,
    takeoverReason: `${EV_FOUNDATION_BASE}.takeover_reason`,
    dataQuality: `${EV_FOUNDATION_BASE}.data_quality`,
    modelJson: `${EV_FOUNDATION_BASE}.model_json`,
    updatedAt: `${EV_FOUNDATION_BASE}.updated_at`,
};
function boolState(id, name) {
    return {
        id,
        common: { name, type: "boolean", role: "state", read: true, write: false },
    };
}
function numState(id, name, unit) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: unit === "W" ? "value.power" : "value",
            unit,
            read: true,
            write: false,
        },
    };
}
function strState(id, name, role = "text") {
    return {
        id,
        common: { name, type: "string", role, read: true, write: false },
    };
}
async function ensureWallboxEvFoundationStates(host) {
    await (0, state_util_1.ensureChannel)(host, EV_FOUNDATION_BASE, "EV-Fundament (Diagnose)");
    await (0, state_util_1.ensureStates)(host, [
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.evccReachable, "EVCC erreichbar"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.vehicleConnected, "Fahrzeug verbunden"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.charging, "Fahrzeug lädt"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.chargePowerW, "Reale Ladeleistung", "W"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.evccMode, "Aktueller EVCC-Modus"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.phasesConfigured, "Konfigurierte Phasen"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.phasesActive, "Aktive Phasen"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct, "Fahrzeug-SOC", "%"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.vehicleSocQuality, "Fahrzeug-SOC Qualität"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.capabilitiesJson, "EV Capabilities (JSON)", "json"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalControlConfigured, "Externe Steuerung konfiguriert"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalControlActive, "Externe Steuerung aktiv"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalControlType, "Externer Steuerungstyp"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.gridRewardsActive, "Grid Rewards aktiv"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.smartChargingActive, "Smart Charging aktiv"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSourceQuality, "Externe Quellenqualität"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSourceUpdatedAt, "Externe Quelle zuletzt", "date"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanMappingConfigured, "Smart-Plan-Mapping konfiguriert"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanParseable, "Smart-Plan parsebar"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanAvailable, "Externer Smart-Plan verfügbar"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanSlotCount, "Smart-Plan gültige Slots"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanNextStart, "Nächster Smart-Plan-Start", "date"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanLastEnd, "Letztes Smart-Plan-Ende", "date"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingEnergyKwh, "Verbleibende externe Planenergie", "kWh"),
        numState(exports.WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingMinutes, "Verbleibende Planminuten", "min"),
        boolState(exports.WALLBOX_EV_FOUNDATION_STATES.externalPlanDeadlineUsed, "Departure-Deadline angewandt"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson, "Smart-Plan Slots (JSON)", "json"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.externalRawDiagnosticsJson, "Externe Rohdiagnose (JSON)", "json"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.preparedEvState, "Vorbereiteter EV-Zustand"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.takeoverReason, "Takeover-Grund (vorbereitet)"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.dataQuality, "EV-Datenqualität"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.modelJson, "EV-Datenmodell V1 (JSON)", "json"),
        strState(exports.WALLBOX_EV_FOUNDATION_STATES.updatedAt, "EV-Fundament zuletzt gelesen", "date"),
    ]);
}
exports.ensureWallboxEvFoundationStates = ensureWallboxEvFoundationStates;

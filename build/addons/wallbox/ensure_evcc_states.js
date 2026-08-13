"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxEvccStates = exports.WALLBOX_EVCC_STATES = void 0;
const tree_paths_1 = require("../../tree_paths");
const state_util_1 = require("../../ems_light/state_util");
const EVCC_BASE = `${(0, tree_paths_1.addonStatusBase)("wallbox")}.evcc`;
exports.WALLBOX_EVCC_STATES = {
    snapshotJson: `${EVCC_BASE}.snapshot_json`,
    updatedAt: `${EVCC_BASE}.updated_at`,
    enabled: `${EVCC_BASE}.enabled`,
    connected: `${EVCC_BASE}.connected`,
    charging: `${EVCC_BASE}.charging`,
    chargePowerW: `${EVCC_BASE}.charge_power_w`,
    sessionEnergyKwh: `${EVCC_BASE}.session_energy_kwh`,
    vehicleSocPct: `${EVCC_BASE}.vehicle_soc_pct`,
    planActive: `${EVCC_BASE}.plan_active`,
    planSocPct: `${EVCC_BASE}.plan_soc_pct`,
    planTime: `${EVCC_BASE}.plan_time`,
    effectivePlanTime: `${EVCC_BASE}.effective_plan_time`,
    activePhases: `${EVCC_BASE}.active_phases`,
    configuredPhases: `${EVCC_BASE}.configured_phases`,
    minCurrentA: `${EVCC_BASE}.min_current_a`,
    maxCurrentA: `${EVCC_BASE}.max_current_a`,
    batteryMode: `${EVCC_BASE}.battery_mode`,
    batteryDischargeControl: `${EVCC_BASE}.battery_discharge_control`,
    chargeRemainingEnergyKwh: `${EVCC_BASE}.charge_remaining_energy_kwh`,
    vehicleName: `${EVCC_BASE}.vehicle_name`,
    vehicleTitle: `${EVCC_BASE}.vehicle_title`,
    effectiveLimitSocPct: `${EVCC_BASE}.effective_limit_soc_pct`,
    batteryBoost: `${EVCC_BASE}.battery_boost`,
    loadpointMode: `${EVCC_BASE}.loadpoint_mode`,
    connection: `${EVCC_BASE}.connection`,
    vehicleRangeKm: `${EVCC_BASE}.vehicle_range_km`,
    vehicleOdometerKm: `${EVCC_BASE}.vehicle_odometer_km`,
    chargeRemainingDurationS: `${EVCC_BASE}.charge_remaining_duration_s`,
    effectiveMaxCurrentA: `${EVCC_BASE}.effective_max_current_a`,
    effectiveMinCurrentA: `${EVCC_BASE}.effective_min_current_a`,
    offeredCurrentA: `${EVCC_BASE}.offered_current_a`,
    chargeCurrentsJson: `${EVCC_BASE}.charge_currents_json`,
    chargeVoltagesJson: `${EVCC_BASE}.charge_voltages_json`,
    sessionPrice: `${EVCC_BASE}.session_price`,
    sessionPricePerKwh: `${EVCC_BASE}.session_price_per_kwh`,
    vehicleDetectionActive: `${EVCC_BASE}.vehicle_detection_active`,
    smartCostLimit: `${EVCC_BASE}.smart_cost_limit`,
    smartCostActive: `${EVCC_BASE}.smart_cost_active`,
};
async function ensureWallboxEvccStates(host) {
    const defs = [
        {
            id: exports.WALLBOX_EVCC_STATES.snapshotJson,
            common: {
                name: "Wallbox EVCC Snapshot (JSON)",
                type: "string",
                role: "json",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.updatedAt,
            common: { name: "Wallbox EVCC zuletzt gelesen", type: "string", role: "date", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.enabled,
            common: { name: "EVCC Ladefreigabe", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.connected,
            common: { name: "EVCC Fahrzeug angeschlossen", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.charging,
            common: { name: "EVCC Laden aktiv", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.chargePowerW,
            common: {
                name: "EVCC Ladeleistung",
                type: "number",
                role: "value.power",
                unit: "W",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.sessionEnergyKwh,
            common: {
                name: "EVCC Sitzungsenergie",
                type: "number",
                role: "value",
                unit: "kWh",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleSocPct,
            common: {
                name: "EVCC Fahrzeug-SOC",
                type: "number",
                role: "value.battery",
                unit: "%",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.planActive,
            common: { name: "EVCC Plan aktiv", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.planSocPct,
            common: {
                name: "EVCC Plan-Ziel-SOC",
                type: "number",
                role: "value.battery",
                unit: "%",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.planTime,
            common: { name: "EVCC Planzeit", type: "string", role: "date", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.effectivePlanTime,
            common: { name: "EVCC effectivePlanTime", type: "string", role: "date", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.activePhases,
            common: { name: "EVCC aktive Phasen", type: "number", role: "value", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.configuredPhases,
            common: { name: "EVCC konfigurierte Phasen", type: "number", role: "value", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.minCurrentA,
            common: {
                name: "EVCC minimaler Ladestrom",
                type: "number",
                role: "value.current",
                unit: "A",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.maxCurrentA,
            common: {
                name: "EVCC maximaler Ladestrom",
                type: "number",
                role: "value.current",
                unit: "A",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.batteryMode,
            common: {
                name: "EVCC Hausbatterie-Modus",
                type: "string",
                role: "state",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.batteryDischargeControl,
            common: {
                name: "EVCC Entladesteuerung aktiv",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh,
            common: {
                name: "EVCC Restenergie (chargeRemaining)",
                type: "number",
                role: "value",
                unit: "kWh",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleName,
            common: { name: "EVCC Fahrzeugname", type: "string", role: "text", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleTitle,
            common: { name: "EVCC Fahrzeug-Titel", type: "string", role: "text", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.effectiveLimitSocPct,
            common: {
                name: "EVCC effectiveLimitSoc",
                type: "number",
                role: "value.battery",
                unit: "%",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.batteryBoost,
            common: { name: "EVCC batteryBoost", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.loadpointMode,
            common: { name: "EVCC Loadpoint-Modus", type: "string", role: "text", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.connection,
            common: { name: "EVCC Verbindung (info.connection)", type: "boolean", role: "state", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleRangeKm,
            common: {
                name: "EVCC Fahrzeugreichweite",
                type: "number",
                role: "value",
                unit: "km",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleOdometerKm,
            common: {
                name: "EVCC Kilometerstand",
                type: "number",
                role: "value",
                unit: "km",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.chargeRemainingDurationS,
            common: {
                name: "EVCC Restladezeit",
                type: "number",
                role: "value",
                unit: "s",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.effectiveMaxCurrentA,
            common: {
                name: "EVCC effectiveMaxCurrent",
                type: "number",
                role: "value.current",
                unit: "A",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.effectiveMinCurrentA,
            common: {
                name: "EVCC effectiveMinCurrent",
                type: "number",
                role: "value.current",
                unit: "A",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.offeredCurrentA,
            common: {
                name: "EVCC offeredCurrent",
                type: "number",
                role: "value.current",
                unit: "A",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.chargeCurrentsJson,
            common: { name: "EVCC chargeCurrents (JSON)", type: "string", role: "json", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.chargeVoltagesJson,
            common: { name: "EVCC chargeVoltages (JSON)", type: "string", role: "json", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.sessionPrice,
            common: { name: "EVCC sessionPrice", type: "number", role: "value", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.sessionPricePerKwh,
            common: { name: "EVCC sessionPricePerKWh", type: "number", role: "value", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.vehicleDetectionActive,
            common: {
                name: "EVCC vehicleDetectionActive (nicht connected-Ersatz)",
                type: "boolean",
                role: "state",
                read: true,
                write: false,
            },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.smartCostLimit,
            common: { name: "EVCC smartCostLimit (nur Diagnose)", type: "number", role: "value", read: true, write: false },
        },
        {
            id: exports.WALLBOX_EVCC_STATES.smartCostActive,
            common: { name: "EVCC smartCostActive (nur Diagnose)", type: "boolean", role: "state", read: true, write: false },
        },
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWallboxEvccStates = ensureWallboxEvccStates;

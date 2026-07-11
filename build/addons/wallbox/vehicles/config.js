"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configuredVehicleDetectionStateIds = exports.configuredVehicleTelemetryStateIds = exports.wallboxVehicleProfilesConfigFromAdapter = exports.WB_EVCC_VEHICLE_NAME_STATE = exports.WB_EVCC_VEHICLE_ID_STATE = exports.WB_MANUAL_VEHICLE_ID = exports.WB_VEHICLE_PROFILES = void 0;
const vehicle_id_1 = require("./vehicle_id");
exports.WB_VEHICLE_PROFILES = "wb_vehicle_profiles";
exports.WB_MANUAL_VEHICLE_ID = "wb_manual_vehicle_id";
exports.WB_EVCC_VEHICLE_ID_STATE = "wb_evcc_vehicle_id_state";
exports.WB_EVCC_VEHICLE_NAME_STATE = "wb_evcc_vehicle_name_state";
function strField(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function rowHasVehicleId(row) {
    const raw = row.vehicle_id;
    if (raw === null || raw === undefined)
        return false;
    return String(raw).trim().length > 0;
}
function profileInputFromRow(row, index) {
    return {
        slotIndex: index,
        vehicleId: row.vehicle_id,
        displayName: row.display_name,
        enabled: row.enabled,
        isGuest: row.is_guest,
        source: row.source,
        evccVehicleId: row.evcc_vehicle_id,
        evccVehicleName: row.evcc_vehicle_name,
        batteryCapacityNetKwh: row.battery_capacity_net_kwh,
        maxAcChargePowerW: row.max_ac_charge_power_w,
        supportedPhases: row.supported_phases,
        preferredPhases: row.preferred_phases,
        minCurrentA: row.min_current_a,
        maxCurrentA: row.max_current_a,
        defaultTargetSocPct: row.default_target_soc_pct,
        minimumDepartureSocPct: row.minimum_departure_soc_pct,
        maximumSocPct: row.maximum_soc_pct,
        chargeEfficiencyPct: row.charge_efficiency_pct,
        socState: row.soc_state,
        rangeState: row.range_state,
        connectedState: row.connected_state,
        chargingState: row.charging_state,
        sessionEnergyState: row.session_energy_state,
    };
}
function parseProfileRows(raw) {
    if (!Array.isArray(raw))
        return [];
    const profiles = [];
    let index = 0;
    for (const entry of raw) {
        if (!entry || typeof entry !== "object")
            continue;
        const row = entry;
        if (!rowHasVehicleId(row))
            continue;
        index += 1;
        profiles.push(profileInputFromRow(row, index));
    }
    return profiles;
}
function wallboxVehicleProfilesConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const manualRaw = strField(c, exports.WB_MANUAL_VEHICLE_ID);
    const manualSanitized = manualRaw ? (0, vehicle_id_1.sanitizeVehicleId)(manualRaw) : null;
    return {
        manualVehicleId: manualSanitized?.valid ? manualSanitized.id : manualRaw || null,
        evccVehicleIdStateId: strField(c, exports.WB_EVCC_VEHICLE_ID_STATE),
        evccVehicleNameStateId: strField(c, exports.WB_EVCC_VEHICLE_NAME_STATE),
        profiles: parseProfileRows(c[exports.WB_VEHICLE_PROFILES]),
    };
}
exports.wallboxVehicleProfilesConfigFromAdapter = wallboxVehicleProfilesConfigFromAdapter;
function configuredVehicleTelemetryStateIds(profiles) {
    const ids = new Set();
    for (const p of profiles) {
        for (const id of [
            p.socStateId,
            p.rangeStateId,
            p.connectedStateId,
            p.chargingStateId,
            p.sessionEnergyStateId,
        ]) {
            if (id)
                ids.add(id);
        }
    }
    return [...ids];
}
exports.configuredVehicleTelemetryStateIds = configuredVehicleTelemetryStateIds;
function configuredVehicleDetectionStateIds(cfg) {
    const ids = [];
    if (cfg.evccVehicleIdStateId)
        ids.push(cfg.evccVehicleIdStateId);
    if (cfg.evccVehicleNameStateId)
        ids.push(cfg.evccVehicleNameStateId);
    return ids;
}
exports.configuredVehicleDetectionStateIds = configuredVehicleDetectionStateIds;

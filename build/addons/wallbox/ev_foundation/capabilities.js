"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEvCapabilities = void 0;
const types_1 = require("./types");
function mapped(id) {
    return id.trim().length > 0;
}
function valid(field) {
    return field.status === "valid";
}
function resolveEvCapabilities(telemetryCfg, snap, foundation, external) {
    if (!foundation.evccIntegrationEnabled) {
        return { ...types_1.EMPTY_EV_CAPABILITIES };
    }
    const connectionKnown = valid(snap.connection);
    const anyRequiredValid = valid(snap.connected) ||
        valid(snap.charging) ||
        valid(snap.charge_power_w) ||
        valid(snap.loadpoint_mode) ||
        valid(snap.max_current_a);
    const evccAvailable = (connectionKnown && snap.connection.value === true) ||
        (!connectionKnown && anyRequiredValid);
    const liveFromTelemetry = valid(snap.vehicle_range_km) ||
        valid(snap.vehicle_odometer_km) ||
        valid(snap.vehicle_name) ||
        valid(snap.vehicle_title);
    const externalControlDetectable = foundation.externalControlType !== "none" ||
        foundation.tibberGridRewardsViaVehicleEnabled ||
        foundation.tibberGridRewardsViaWallboxEnabled ||
        mapped(foundation.externalControlActiveStateId) ||
        mapped(foundation.externalGridRewardsActiveStateId) ||
        mapped(foundation.holdSignals.tibberGridRewardsActiveStateId);
    const externalSmartPlanAvailable = external?.smartPlan.validPlanPresent === true;
    return {
        evccAvailable,
        vehicleSocAvailable: mapped(telemetryCfg.vehicleSocStateId) && valid(snap.vehicle_soc_pct),
        vehicleConnectedAvailable: mapped(telemetryCfg.connectedStateId) && valid(snap.connected),
        chargePowerAvailable: mapped(telemetryCfg.chargePowerWStateId) && valid(snap.charge_power_w),
        realChargePhaseAvailable: mapped(telemetryCfg.activePhasesStateId) && valid(snap.active_phases),
        vehicleLiveDataAvailable: foundation.vehicleLiveDataAvailable || liveFromTelemetry,
        externalControlDetectable,
        externalSmartPlanAvailable,
        tibberGridRewardsViaVehicle: foundation.tibberGridRewardsViaVehicleEnabled,
        tibberGridRewardsViaWallbox: foundation.tibberGridRewardsViaWallboxEnabled,
        homeAssistantDataSourceAvailable: foundation.homeAssistantDataSourceEnabled,
        externalControlConfigured: external?.externalControlConfigured === true,
    };
}
exports.resolveEvCapabilities = resolveEvCapabilities;

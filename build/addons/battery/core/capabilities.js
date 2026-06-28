"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCapabilityAvailable = exports.emptyCapabilityMatrix = exports.capability = exports.ALL_BATTERY_CAPABILITIES = void 0;
exports.ALL_BATTERY_CAPABILITIES = [
    "read_soc",
    "read_power",
    "read_capacity",
    "read_operating_mode",
    "read_online_status",
    "set_operating_mode",
    "set_charge_power",
    "set_discharge_power",
    "enable_grid_charge",
    "hold_battery",
    "control_grid_balance",
    "verify_operating_mode",
    "verify_charge_power",
    "safe_restore",
    "live_control",
];
function capability(supported, configured, reason) {
    const available = supported && configured;
    const status = { supported, configured, available };
    if (!available && reason) {
        status.reason = reason;
    }
    return status;
}
exports.capability = capability;
function emptyCapabilityMatrix() {
    const matrix = {};
    for (const id of exports.ALL_BATTERY_CAPABILITIES) {
        matrix[id] = { supported: false, configured: false, available: false };
    }
    return matrix;
}
exports.emptyCapabilityMatrix = emptyCapabilityMatrix;
function isCapabilityAvailable(matrix, id) {
    return matrix[id]?.available === true;
}
exports.isCapabilityAvailable = isCapabilityAvailable;

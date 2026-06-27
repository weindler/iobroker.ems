"use strict";
/** Immersion heater runtime — Phase 3C.1 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMMERSION_RUNTIME_STATES = exports.IMMERSION_RUNTIME_BASE = void 0;
exports.IMMERSION_RUNTIME_BASE = "addons.immersion_heater.runtime";
exports.IMMERSION_RUNTIME_STATES = {
    available: `${exports.IMMERSION_RUNTIME_BASE}.available`,
    state: `${exports.IMMERSION_RUNTIME_BASE}.state`,
    requestedMode: `${exports.IMMERSION_RUNTIME_BASE}.requested_mode`,
    resolvedMode: `${exports.IMMERSION_RUNTIME_BASE}.resolved_mode`,
    bufferTemperatureC: `${exports.IMMERSION_RUNTIME_BASE}.buffer_temperature_c`,
    temperatureStatus: `${exports.IMMERSION_RUNTIME_BASE}.temperature_status`,
    planningMinTempC: `${exports.IMMERSION_RUNTIME_BASE}.planning_min_temp_c`,
    planningMaxTempC: `${exports.IMMERSION_RUNTIME_BASE}.planning_max_temp_c`,
    forceTargetTempC: `${exports.IMMERSION_RUNTIME_BASE}.force_target_temp_c`,
    forceUntil: `${exports.IMMERSION_RUNTIME_BASE}.force_until`,
    commandedStage: `${exports.IMMERSION_RUNTIME_BASE}.commanded_stage`,
    commandedPowerW: `${exports.IMMERSION_RUNTIME_BASE}.commanded_power_w`,
    feedbackStage: `${exports.IMMERSION_RUNTIME_BASE}.feedback_stage`,
    measuredPowerW: `${exports.IMMERSION_RUNTIME_BASE}.measured_power_w`,
    powerVerificationStatus: `${exports.IMMERSION_RUNTIME_BASE}.power_verification_status`,
    minRuntimeRemainingSec: `${exports.IMMERSION_RUNTIME_BASE}.minimum_runtime_remaining_sec`,
    minPauseRemainingSec: `${exports.IMMERSION_RUNTIME_BASE}.minimum_pause_remaining_sec`,
    lastSwitchAt: `${exports.IMMERSION_RUNTIME_BASE}.last_switch_at`,
    faultActive: `${exports.IMMERSION_RUNTIME_BASE}.fault_active`,
    faultCode: `${exports.IMMERSION_RUNTIME_BASE}.fault_code`,
    faultSince: `${exports.IMMERSION_RUNTIME_BASE}.fault_since`,
    faultMessage: `${exports.IMMERSION_RUNTIME_BASE}.fault_message`,
    faultReset: `${exports.IMMERSION_RUNTIME_BASE}.fault_reset`,
    reason: `${exports.IMMERSION_RUNTIME_BASE}.reason`,
    snapshotJson: `${exports.IMMERSION_RUNTIME_BASE}.snapshot_json`,
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.controlResult = exports.validateForceTarget = exports.buildControlThermalRequest = exports.parseControlMode = exports.THERMAL_CONTROL_LAST_RESULT = exports.THERMAL_CONTROL_FORCE_UNTIL = exports.THERMAL_CONTROL_FORCE_TARGET = exports.THERMAL_CONTROL_REQUESTED_MODE = void 0;
const constants_1 = require("../core/constants");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const fsm_1 = require("../../addons/immersion_heater/runtime/fsm");
exports.THERMAL_CONTROL_REQUESTED_MODE = "user_intent.thermal.control.requested_mode";
exports.THERMAL_CONTROL_FORCE_TARGET = "user_intent.thermal.control.force_target_temp_c";
exports.THERMAL_CONTROL_FORCE_UNTIL = "user_intent.thermal.control.force_until";
exports.THERMAL_CONTROL_LAST_RESULT = "user_intent.thermal.control.last_result_json";
const VALID_MODES = ["off", "auto", "force"];
function parseControlMode(raw) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const s = String(raw).trim().toLowerCase();
    if (VALID_MODES.includes(s))
        return s;
    return null;
}
exports.parseControlMode = parseControlMode;
function buildControlThermalRequest(input) {
    const { mode, forceTargetTempC, forceUntil, config, issuedAt } = input;
    const deviceCfg = (0, device_config_1.immersionDeviceConfigFromAdapter)(config);
    const values = {
        operating_request: (0, fsm_1.controlModeToOperatingRequest)(mode),
    };
    if (mode === "force") {
        const target = (0, device_config_1.effectiveForceTarget)(deviceCfg, forceTargetTempC);
        values.target_temperature_c = target;
        if (forceUntil) {
            values.ready_at = { at: forceUntil, timezone: "Europe/Berlin" };
        }
    }
    return {
        schema_version: constants_1.INTENT_SCHEMA_VERSION,
        request_id: `control-${issuedAt}`,
        issued_at: issuedAt,
        owner: { type: "user", id: "local_user" },
        values,
    };
}
exports.buildControlThermalRequest = buildControlThermalRequest;
function validateForceTarget(raw, config) {
    if (raw === null || raw === undefined || raw === "") {
        const deviceCfg = (0, device_config_1.immersionDeviceConfigFromAdapter)(config);
        return { ok: true, value: deviceCfg.planningMaxTempC };
    }
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n))
        return { ok: false, error: "invalid_force_target" };
    const deviceCfg = (0, device_config_1.immersionDeviceConfigFromAdapter)(config);
    if (n > deviceCfg.planningMaxTempC)
        return { ok: false, error: "force_target_above_max" };
    if (n < deviceCfg.planningMinTempC)
        return { ok: false, error: "force_target_below_min" };
    return { ok: true, value: n };
}
exports.validateForceTarget = validateForceTarget;
function controlResult(status, errors, requestId) {
    return {
        request_id: requestId,
        status: status,
        processed_at: new Date().toISOString(),
        revision: 0,
        errors,
    };
}
exports.controlResult = controlResult;

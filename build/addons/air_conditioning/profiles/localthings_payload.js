"use strict";
/** Write-Payloads für Samsung LocalThings über hass.0 (stringified JSON). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringifyLocalthingsPayload = exports.localthingsSwingModePayload = exports.localthingsPresetModePayload = exports.localthingsFanModePayload = exports.localthingsTemperaturePayload = exports.localthingsHvacModePayload = void 0;
function localthingsHvacModePayload(mode) {
    return { hvac_mode: String(mode ?? "").trim() };
}
exports.localthingsHvacModePayload = localthingsHvacModePayload;
function localthingsTemperaturePayload(temperatureC) {
    return { temperature: temperatureC };
}
exports.localthingsTemperaturePayload = localthingsTemperaturePayload;
function localthingsFanModePayload(fanMode) {
    return { fan_mode: String(fanMode ?? "").trim() };
}
exports.localthingsFanModePayload = localthingsFanModePayload;
function localthingsPresetModePayload(preset) {
    return { preset_mode: String(preset ?? "").trim() };
}
exports.localthingsPresetModePayload = localthingsPresetModePayload;
function localthingsSwingModePayload(swing) {
    return { swing_mode: String(swing ?? "").trim() };
}
exports.localthingsSwingModePayload = localthingsSwingModePayload;
function stringifyLocalthingsPayload(payload) {
    return JSON.stringify(payload);
}
exports.stringifyLocalthingsPayload = stringifyLocalthingsPayload;

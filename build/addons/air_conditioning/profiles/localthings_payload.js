"use strict";
/** Write-Payloads für Samsung LocalThings über hass.0 (stringified JSON). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.localthingsHvacModePayload = localthingsHvacModePayload;
exports.localthingsTemperaturePayload = localthingsTemperaturePayload;
exports.localthingsFanModePayload = localthingsFanModePayload;
exports.localthingsPresetModePayload = localthingsPresetModePayload;
exports.localthingsSwingModePayload = localthingsSwingModePayload;
exports.stringifyLocalthingsPayload = stringifyLocalthingsPayload;
function localthingsHvacModePayload(mode) {
    return { hvac_mode: String(mode ?? "").trim() };
}
function localthingsTemperaturePayload(temperatureC) {
    return { temperature: temperatureC };
}
function localthingsFanModePayload(fanMode) {
    return { fan_mode: String(fanMode ?? "").trim() };
}
function localthingsPresetModePayload(preset) {
    return { preset_mode: String(preset ?? "").trim() };
}
function localthingsSwingModePayload(swing) {
    return { swing_mode: String(swing ?? "").trim() };
}
function stringifyLocalthingsPayload(payload) {
    return JSON.stringify(payload);
}

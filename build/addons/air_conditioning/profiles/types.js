"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modeStringsForPurpose = modeStringsForPurpose;
exports.optionalStep = optionalStep;
function modeStringsForPurpose(unit, purpose) {
    switch (purpose) {
        case "dehumidify":
            return {
                mode: unit.modeWhenDehumidify,
                fanMode: unit.fanModeWhenDehumidify,
                fanSpeed: "",
            };
        case "fan_only":
            return {
                mode: unit.modeWhenFanOnly,
                fanMode: unit.fanModeWhenFanOnly,
                fanSpeed: "",
            };
        case "heating":
            return {
                mode: unit.modeWhenHeating,
                fanMode: unit.fanModeWhenHeating,
                fanSpeed: "",
            };
        default:
            return {
                mode: unit.modeWhenCooling,
                fanMode: unit.fanModeWhenCooling,
                fanSpeed: unit.fanSpeedWhenCooling,
            };
    }
}
function optionalStep(role, value) {
    if (value === "" || value === null || value === undefined) {
        return [];
    }
    return [{ kind: "set", role, value }];
}

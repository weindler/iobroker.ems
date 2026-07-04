"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAcProfile = exports.AC_PROFILES = exports.SAMSUNG_SMARTTHINGS_PROFILE = exports.GENERIC_AC_PROFILE = void 0;
const constants_1 = require("../constants");
const types_1 = require("./types");
function samsungCoolingStart(unit, purpose) {
    const { mode, fanMode, fanSpeed } = (0, types_1.modeStringsForPurpose)(unit, purpose);
    const steps = [
        { kind: "set", role: "cmd_cleaning_mode", value: "off" },
        { kind: "set", role: "cmd_set_cool_setpoint", value: unit.coolingSetpointC },
        { kind: "delay_ms", ms: constants_1.AC_WRITE_SETPOINT_DELAY_MS },
        { kind: "set", role: "cmd_set_mode", value: mode },
        { kind: "set", role: "cmd_set_fan_mode", value: fanMode },
        ...(0, types_1.optionalStep)("cmd_set_fan_speed", fanSpeed),
        { kind: "toggle", role: "cmd_switch_on" },
        { kind: "delay_ms", ms: constants_1.AC_WRITE_REFRESH_DELAY_MS },
        { kind: "toggle", role: "cmd_refresh" },
    ];
    return steps;
}
exports.GENERIC_AC_PROFILE = {
    id: "generic",
    displayNameDe: "Generic (Mapping-basiert)",
    coolingStartSequence: (unit, purpose) => {
        const { mode, fanMode, fanSpeed } = (0, types_1.modeStringsForPurpose)(unit, purpose);
        return [
            { kind: "set", role: "cmd_set_cool_setpoint", value: unit.coolingSetpointC },
            { kind: "set", role: "cmd_set_mode", value: mode },
            { kind: "set", role: "cmd_set_fan_mode", value: fanMode },
            ...(0, types_1.optionalStep)("cmd_set_fan_speed", fanSpeed),
            { kind: "toggle", role: "cmd_switch_on" },
        ];
    },
    cleaningStartSequence: () => [
        { kind: "set", role: "cmd_cleaning_start", value: "autoClean" },
        { kind: "set", role: "cmd_cleaning_mode", value: "on" },
    ],
    cleaningStopSequence: () => [
        { kind: "set", role: "cmd_cleaning_mode", value: "off" },
        { kind: "toggle", role: "cmd_refresh" },
    ],
};
exports.SAMSUNG_SMARTTHINGS_PROFILE = {
    id: "samsung_smartthings",
    displayNameDe: "Samsung SmartThings",
    coolingStartSequence: samsungCoolingStart,
    cleaningStartSequence: () => [
        { kind: "toggle", role: "cmd_refresh" },
        { kind: "set", role: "cmd_cleaning_start", value: "autoClean" },
        { kind: "set", role: "cmd_cleaning_mode", value: "on" },
    ],
    cleaningStopSequence: () => [
        { kind: "set", role: "cmd_cleaning_mode", value: "off" },
        { kind: "toggle", role: "cmd_refresh" },
    ],
};
exports.AC_PROFILES = [exports.GENERIC_AC_PROFILE, exports.SAMSUNG_SMARTTHINGS_PROFILE];
function getAcProfile(id) {
    return exports.AC_PROFILES.find((p) => p.id === id) ?? exports.GENERIC_AC_PROFILE;
}
exports.getAcProfile = getAcProfile;

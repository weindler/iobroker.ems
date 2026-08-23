"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLocalthingsHassProfile = exports.getAcProfile = exports.AC_PROFILES = exports.SAMSUNG_LOCALTHINGS_HASS_PROFILE = exports.SAMSUNG_SMARTTHINGS_PROFILE = exports.GENERIC_AC_PROFILE = void 0;
const constants_1 = require("../constants");
const localthings_payload_1 = require("./localthings_payload");
const types_1 = require("./types");
function samsungCoolingStart(unit, purpose) {
    const { mode, fanMode, fanSpeed } = (0, types_1.modeStringsForPurpose)(unit, purpose);
    const steps = [
        // setAutoCleaningMode: gültige Werte on|speedClean|quietClean|timedClean|off — kein autoClean, kein Odor-Controller
        ...(0, types_1.optionalStep)("cmd_cleaning_start", "off"),
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
function localthingsCoolingStart(unit, purpose) {
    const { mode, fanMode } = (0, types_1.modeStringsForPurpose)(unit, purpose);
    const steps = [
        {
            kind: "set_json",
            role: "cmd_set_cool_setpoint",
            payload: (0, localthings_payload_1.localthingsTemperaturePayload)(unit.coolingSetpointC),
        },
        { kind: "delay_ms", ms: constants_1.AC_WRITE_SETPOINT_DELAY_MS },
        {
            kind: "set_json",
            role: "cmd_set_mode",
            payload: (0, localthings_payload_1.localthingsHvacModePayload)(mode),
        },
    ];
    if (fanMode.trim()) {
        steps.push({
            kind: "set_json",
            role: "cmd_set_fan_mode",
            payload: (0, localthings_payload_1.localthingsFanModePayload)(fanMode),
        });
    }
    steps.push({ kind: "toggle", role: "cmd_switch_on" });
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
    coolingStopSequence: () => [
        { kind: "switch_off" },
        { kind: "delay_ms", ms: constants_1.AC_WRITE_REFRESH_DELAY_MS },
        { kind: "toggle", role: "cmd_refresh" },
    ],
    cleaningStartSequence: () => [{ kind: "set", role: "cmd_cleaning_start", value: "on" }],
    cleaningStopSequence: () => [
        { kind: "set", role: "cmd_cleaning_start", value: "off" },
        { kind: "toggle", role: "cmd_refresh" },
    ],
};
exports.SAMSUNG_SMARTTHINGS_PROFILE = {
    id: "samsung_smartthings",
    displayNameDe: "Samsung SmartThings",
    coolingStartSequence: samsungCoolingStart,
    // Nicht pulse-true auf dem Switch: das wäre „an“. Shared Switch → set off; eigener Off-Button → pulse.
    coolingStopSequence: () => [
        { kind: "switch_off" },
        { kind: "delay_ms", ms: constants_1.AC_WRITE_REFRESH_DELAY_MS },
        { kind: "toggle", role: "cmd_refresh" },
    ],
    cleaningStartSequence: () => [
        { kind: "toggle", role: "cmd_refresh" },
        { kind: "set", role: "cmd_cleaning_start", value: "on" },
    ],
    cleaningStopSequence: () => [
        { kind: "set", role: "cmd_cleaning_start", value: "off" },
        { kind: "toggle", role: "cmd_refresh" },
    ],
};
/** Samsung WindFree / RAC über Home Assistant LocalThings → hass.0. */
exports.SAMSUNG_LOCALTHINGS_HASS_PROFILE = {
    id: "samsung_localthings_hass",
    displayNameDe: "Samsung LocalThings (Home Assistant)",
    coolingStartSequence: localthingsCoolingStart,
    coolingStopSequence: () => [{ kind: "switch_off" }],
    cleaningStartSequence: () => [{ kind: "toggle", role: "cmd_cleaning_start" }],
    cleaningStopSequence: () => [{ kind: "toggle", role: "cmd_cleaning_off" }],
};
exports.AC_PROFILES = [
    exports.GENERIC_AC_PROFILE,
    exports.SAMSUNG_SMARTTHINGS_PROFILE,
    exports.SAMSUNG_LOCALTHINGS_HASS_PROFILE,
];
function getAcProfile(id) {
    return exports.AC_PROFILES.find((p) => p.id === id) ?? exports.GENERIC_AC_PROFILE;
}
exports.getAcProfile = getAcProfile;
function isLocalthingsHassProfile(id) {
    return id === exports.SAMSUNG_LOCALTHINGS_HASS_PROFILE.id;
}
exports.isLocalthingsHassProfile = isLocalthingsHassProfile;

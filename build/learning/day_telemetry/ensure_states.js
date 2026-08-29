"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_TELEMETRY_STATE_IDS = exports.ensureDayTelemetryStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
const constants_1 = require("./constants");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def = false) {
    return {
        id,
        common: { name, type: "boolean", role: "indicator", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensureDayTelemetryStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.day_telemetry", "EMS-Light Tages-Telemetrie");
    const defs = [
        strState(constants_1.DAY_TELEMETRY_STATES.status, "Tages-Telemetrie Status", "idle"),
        strState(constants_1.DAY_TELEMETRY_STATES.lastSlotWrittenAt, "Tages-Telemetrie letzter Slot (ISO)"),
        boolState(constants_1.DAY_TELEMETRY_STATES.recoveryPending, "Tages-Telemetrie Recovery ausstehend", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureDayTelemetryStates = ensureDayTelemetryStates;
exports.DAY_TELEMETRY_STATE_IDS = Object.values(constants_1.DAY_TELEMETRY_STATES);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureIntentStates = exports.ensureIntentChannels = exports.USER_INTENT_WALLBOX_DIAG_CHANNEL = exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL = exports.USER_INTENT_BATTERY_INPUTS_CHANNEL = exports.USER_INTENT_THERMAL_INPUTS_CHANNEL = exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL = exports.USER_INTENT_IOBROKER_CHANNEL = exports.USER_INTENT_INPUTS_CHANNEL = exports.USER_INTENT_BATTERY_CHANNEL = exports.USER_INTENT_THERMAL_CHANNEL = exports.USER_INTENT_WALLBOX_CHANNEL = exports.USER_INTENT_CHANNEL = void 0;
const state_util_1 = require("../ems_light/state_util");
const constants_1 = require("./core/constants");
function strState(id, name, def, write = false, extendCommon) {
    return {
        id,
        common: {
            name,
            type: "string",
            role: "text",
            read: !write,
            write,
            def,
        },
        defaultVal: def,
        setDefaultIfEmpty: !write,
        extendCommon,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: "value",
            read: true,
            write: false,
            def,
        },
        defaultVal: def,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: {
            name,
            type: "boolean",
            role: "switch",
            read: true,
            write: false,
            def,
        },
        defaultVal: def,
    };
}
function domainMirrorStates(prefix, label) {
    return [
        strState(`${prefix}.resolved_json`, `${label} Intent (aufgelöst, JSON)`, "{}"),
        numState(`${prefix}.revision`, `${label} Intent Revision`, 0),
        strState(`${prefix}.intent_state`, `${label} Intent State`, "none"),
        strState(`${prefix}.last_changed`, `${label} Intent zuletzt geändert (ISO)`, ""),
        boolState(`${prefix}.manual_override_active`, `${label} Manual Override aktiv`, false),
        strState(`${prefix}.source_summary`, `${label} Intent Quellen (JSON)`, "[]"),
        strState(`${prefix}.diagnostics.last_error`, `${label} Intent letzter Fehler`, ""),
    ];
}
function domainRequestStates(prefix, label) {
    return [
        strState(`${prefix}.request_json`, `${label} Intent Request (JSON)`, "", true),
        strState(`${prefix}.result_json`, `${label} Intent Request Ergebnis (JSON)`, "{}"),
    ];
}
exports.USER_INTENT_CHANNEL = "user_intent";
exports.USER_INTENT_WALLBOX_CHANNEL = "user_intent.wallbox";
exports.USER_INTENT_THERMAL_CHANNEL = "user_intent.thermal";
exports.USER_INTENT_BATTERY_CHANNEL = "user_intent.battery";
exports.USER_INTENT_INPUTS_CHANNEL = "user_intent.inputs";
exports.USER_INTENT_IOBROKER_CHANNEL = "user_intent.inputs.iobroker";
exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL = "user_intent.inputs.iobroker.wallbox";
exports.USER_INTENT_THERMAL_INPUTS_CHANNEL = "user_intent.inputs.iobroker.thermal";
exports.USER_INTENT_BATTERY_INPUTS_CHANNEL = "user_intent.inputs.iobroker.battery";
exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL = "user_intent.wallbox.sources";
exports.USER_INTENT_WALLBOX_DIAG_CHANNEL = "user_intent.wallbox.diagnostics";
async function ensureIntentChannels(host) {
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_CHANNEL, "EMS-Light User Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_CHANNEL, "EMS-Light Wallbox Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_THERMAL_CHANNEL, "EMS-Light Thermal Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_BATTERY_CHANNEL, "EMS-Light Battery Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_INPUTS_CHANNEL, "EMS-Light Intent Inputs");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_IOBROKER_CHANNEL, "EMS-Light ioBroker Intent Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL, "EMS-Light Wallbox ioBroker Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_THERMAL_INPUTS_CHANNEL, "EMS-Light Thermal ioBroker Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_BATTERY_INPUTS_CHANNEL, "EMS-Light Battery ioBroker Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL, "EMS-Light Wallbox Intent Sources");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_DIAG_CHANNEL, "EMS-Light Wallbox Intent Diagnostics");
    await (0, state_util_1.ensureChannel)(host, "user_intent.wallbox.sources.evcc", "EMS-Light EVCC Intent Source");
    await (0, state_util_1.ensureChannel)(host, "user_intent.wallbox.sources.admin", "EMS-Light Admin Intent Defaults");
    await (0, state_util_1.ensureChannel)(host, "user_intent.thermal.diagnostics", "EMS-Light Thermal Intent Diagnostics");
    await (0, state_util_1.ensureChannel)(host, "user_intent.battery.diagnostics", "EMS-Light Battery Intent Diagnostics");
}
exports.ensureIntentChannels = ensureIntentChannels;
async function ensureIntentStates(host) {
    await ensureIntentChannels(host);
    const defs = [
        strState("user_intent.contract_version", "User Intent Contract Version", constants_1.INTENT_CONTRACT_VERSION, false, true),
        strState("user_intent.status", "User Intent Engine Status", "not_initialized"),
        strState("user_intent.resolved_all_json", "User Intent Gesamtvertrag (JSON)", "{}"),
        numState("user_intent.resolved_all.revision", "User Intent Gesamt-Revision", 0),
        ...domainMirrorStates("user_intent.wallbox", "Wallbox"),
        strState("user_intent.wallbox.diagnostics.last_resolution_json", "Wallbox Intent letzte Auflösung (JSON)", "{}"),
        strState("user_intent.wallbox.sources.evcc.snapshot_json", "EVCC Intent Snapshot (JSON)", "{}"),
        strState("user_intent.wallbox.sources.evcc.status", "EVCC Intent Source Status", "unconfigured"),
        strState("user_intent.wallbox.sources.evcc.last_observed", "EVCC Intent zuletzt beobachtet (ISO)", ""),
        strState("user_intent.wallbox.sources.admin.snapshot_json", "Admin Intent Defaults (JSON)", "{}"),
        ...domainMirrorStates("user_intent.thermal", "Thermal"),
        ...domainMirrorStates("user_intent.battery", "Battery"),
        ...domainRequestStates("user_intent.inputs.iobroker.wallbox", "Wallbox"),
        ...domainRequestStates("user_intent.inputs.iobroker.thermal", "Thermal"),
        ...domainRequestStates("user_intent.inputs.iobroker.battery", "Battery"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureIntentStates = ensureIntentStates;

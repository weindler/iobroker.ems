"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureIntentStates = exports.ensureIntentChannels = exports.USER_INTENT_WALLBOX_DIAG_CHANNEL = exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL = exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL = exports.USER_INTENT_IOBROKER_CHANNEL = exports.USER_INTENT_INPUTS_CHANNEL = exports.USER_INTENT_WALLBOX_CHANNEL = exports.USER_INTENT_CHANNEL = void 0;
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
exports.USER_INTENT_CHANNEL = "user_intent";
exports.USER_INTENT_WALLBOX_CHANNEL = "user_intent.wallbox";
exports.USER_INTENT_INPUTS_CHANNEL = "user_intent.inputs";
exports.USER_INTENT_IOBROKER_CHANNEL = "user_intent.inputs.iobroker";
exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL = "user_intent.inputs.iobroker.wallbox";
exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL = "user_intent.wallbox.sources";
exports.USER_INTENT_WALLBOX_DIAG_CHANNEL = "user_intent.wallbox.diagnostics";
async function ensureIntentChannels(host) {
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_CHANNEL, "EMS-Light User Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_CHANNEL, "EMS-Light Wallbox Intent");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_INPUTS_CHANNEL, "EMS-Light Intent Inputs");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_IOBROKER_CHANNEL, "EMS-Light ioBroker Intent Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_INPUTS_CHANNEL, "EMS-Light Wallbox ioBroker Input");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_SOURCES_CHANNEL, "EMS-Light Wallbox Intent Sources");
    await (0, state_util_1.ensureChannel)(host, exports.USER_INTENT_WALLBOX_DIAG_CHANNEL, "EMS-Light Wallbox Intent Diagnostics");
    await (0, state_util_1.ensureChannel)(host, "user_intent.wallbox.sources.evcc", "EMS-Light EVCC Intent Source");
    await (0, state_util_1.ensureChannel)(host, "user_intent.wallbox.sources.admin", "EMS-Light Admin Intent Defaults");
}
exports.ensureIntentChannels = ensureIntentChannels;
async function ensureIntentStates(host) {
    await ensureIntentChannels(host);
    const defs = [
        strState("user_intent.contract_version", "User Intent Contract Version", constants_1.INTENT_CONTRACT_VERSION, false, true),
        strState("user_intent.status", "User Intent Engine Status", "not_initialized"),
        strState("user_intent.wallbox.resolved_json", "Wallbox Intent (aufgelöst, JSON)", "{}"),
        numState("user_intent.wallbox.revision", "Wallbox Intent Revision", 0),
        strState("user_intent.wallbox.intent_state", "Wallbox Intent State", "none"),
        strState("user_intent.wallbox.last_changed", "Wallbox Intent zuletzt geändert (ISO)", ""),
        boolState("user_intent.wallbox.manual_override_active", "Wallbox Manual Override aktiv", false),
        strState("user_intent.wallbox.source_summary", "Wallbox Intent Quellen (JSON)", "[]"),
        strState("user_intent.wallbox.sources.evcc.snapshot_json", "EVCC Intent Snapshot (JSON)", "{}"),
        strState("user_intent.wallbox.sources.evcc.status", "EVCC Intent Source Status", "unconfigured"),
        strState("user_intent.wallbox.sources.evcc.last_observed", "EVCC Intent zuletzt beobachtet (ISO)", ""),
        strState("user_intent.wallbox.sources.admin.snapshot_json", "Admin Intent Defaults (JSON)", "{}"),
        strState("user_intent.inputs.iobroker.wallbox.request_json", "Wallbox Intent Request (JSON)", "", true),
        strState("user_intent.inputs.iobroker.wallbox.result_json", "Wallbox Intent Request Ergebnis (JSON)", "{}"),
        strState("user_intent.wallbox.diagnostics.last_error", "Wallbox Intent letzter Fehler", ""),
        strState("user_intent.wallbox.diagnostics.last_resolution_json", "Wallbox Intent letzte Auflösung (JSON)", "{}"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureIntentStates = ensureIntentStates;

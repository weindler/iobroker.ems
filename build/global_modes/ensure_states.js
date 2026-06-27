"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureGlobalModesStates = exports.ensureGlobalModesChannels = exports.GLOBAL_MODES_CHANNEL = void 0;
const state_util_1 = require("../ems_light/state_util");
function strState(id, name, def, write = false) {
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
exports.GLOBAL_MODES_CHANNEL = "global_modes";
async function ensureGlobalModesChannels(host) {
    await (0, state_util_1.ensureChannel)(host, exports.GLOBAL_MODES_CHANNEL, "EMS-Light Global Modes");
}
exports.ensureGlobalModesChannels = ensureGlobalModesChannels;
async function ensureGlobalModesStates(host, adminDefault) {
    await ensureGlobalModesChannels(host);
    const defs = [
        strState("global_modes.requested", "Global Mode (Benutzerwunsch)", adminDefault, true),
        strState("global_modes.active", "Global Mode aktiv", adminDefault),
        strState("global_modes.available_json", "Global Modes verfügbar (JSON)", "[]"),
        strState("global_modes.effective_profile_json", "Global Mode Profil (JSON)", "{}"),
        strState("global_modes.status", "Global Modes Status", "not_initialized"),
        boolState("global_modes.valid", "Global Modes gültig", false),
        strState("global_modes.issues_json", "Global Modes Issues (JSON)", "[]"),
        strState("global_modes.revision", "Global Modes Revision", ""),
        strState("global_modes.updated_at", "Global Modes aktualisiert (ISO)", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureGlobalModesStates = ensureGlobalModesStates;

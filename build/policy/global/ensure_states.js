"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAddonPolicyStates = exports.ensureGlobalPolicyStates = exports.ensureSystemPolicyStates = exports.ensurePolicyChannels = void 0;
const state_util_1 = require("../../ems_light/state_util");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: { name, type: "boolean", role: "switch", read: true, write: false, def },
        defaultVal: def,
    };
}
async function ensurePolicyChannels(host) {
    await (0, state_util_1.ensureChannel)(host, "policy", "EMS-Light Policy");
    await (0, state_util_1.ensureChannel)(host, "policy.system", "EMS-Light Policy System");
    await (0, state_util_1.ensureChannel)(host, "policy.global", "EMS-Light Policy Global");
}
exports.ensurePolicyChannels = ensurePolicyChannels;
async function ensureSystemPolicyStates(host) {
    await ensurePolicyChannels(host);
    const defs = [
        strState("policy.system.schema_version", "Policy Schema-Version"),
        strState("policy.system.engine_version", "Policy Engine-Version"),
        strState("policy.system.status", "Policy Engine Status", "not_initialized"),
        boolState("policy.system.valid", "Policy Engine gültig", false),
        strState("policy.system.issues_json", "Policy Engine Issues (JSON)", "[]"),
        strState("policy.system.registered_providers_json", "Policy Provider Registry (JSON)", "[]"),
        strState("policy.system.revision", "Policy Engine Revision", ""),
        strState("policy.system.updated_at", "Policy Engine aktualisiert (ISO)", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureSystemPolicyStates = ensureSystemPolicyStates;
async function ensureGlobalPolicyStates(host) {
    await ensurePolicyChannels(host);
    const defs = [
        strState("policy.global.configured_json", "Globale Policy konfiguriert (JSON)", "{}"),
        strState("policy.global.effective_json", "Globale Policy effektiv (JSON)", "{}"),
        strState("policy.global.provenance_json", "Globale Policy Herkunft (JSON)", "{}"),
        strState("policy.global.status", "Globale Policy Status", "not_initialized"),
        boolState("policy.global.valid", "Globale Policy gültig", false),
        strState("policy.global.issues_json", "Globale Policy Issues (JSON)", "[]"),
        strState("policy.global.revision", "Globale Policy Revision", ""),
        strState("policy.global.updated_at", "Globale Policy aktualisiert (ISO)", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureGlobalPolicyStates = ensureGlobalPolicyStates;
/** Vorbereitung Phase 3B — States für Add-on-Instanzen */
async function ensureAddonPolicyStates(host, addonType, instanceId) {
    const base = `policy.${addonType}.${instanceId}`;
    await (0, state_util_1.ensureChannel)(host, `policy.${addonType}`, `EMS-Light Policy ${addonType}`);
    await (0, state_util_1.ensureChannel)(host, base, `EMS-Light Policy ${addonType} ${instanceId}`);
    const defs = [
        strState(`${base}.configured_json`, `${addonType} Policy konfiguriert (JSON)`, "{}"),
        strState(`${base}.effective_json`, `${addonType} Policy effektiv (JSON)`, "{}"),
        strState(`${base}.provenance_json`, `${addonType} Policy Herkunft (JSON)`, "{}"),
        strState(`${base}.status`, `${addonType} Policy Status`, "not_initialized"),
        boolState(`${base}.valid`, `${addonType} Policy gültig`, false),
        strState(`${base}.issues_json`, `${addonType} Policy Issues (JSON)`, "[]"),
        strState(`${base}.revision`, `${addonType} Policy Revision`, "{}"),
        strState(`${base}.updated_at`, `${addonType} Policy aktualisiert (ISO)`, ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureAddonPolicyStates = ensureAddonPolicyStates;

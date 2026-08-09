"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAiUserEnabledToggle = exports.migrateAiUserEnabledOnce = exports.isAiPublishAllowed = exports.readAiUserEnabled = exports.resetAiEnableEpochForTest = exports.bumpAiEnableEpoch = exports.currentAiEnableEpoch = void 0;
const state_util_1 = require("../ems_light/state_util");
const ensure_states_1 = require("./ensure_states");
/** Enable-Epoch: jeder Toggle invalidiert laufende Requests (Publish-Guard). */
let aiEnableEpoch = 0;
function currentAiEnableEpoch() {
    return aiEnableEpoch;
}
exports.currentAiEnableEpoch = currentAiEnableEpoch;
function bumpAiEnableEpoch() {
    aiEnableEpoch += 1;
    return aiEnableEpoch;
}
exports.bumpAiEnableEpoch = bumpAiEnableEpoch;
function resetAiEnableEpochForTest() {
    aiEnableEpoch = 0;
}
exports.resetAiEnableEpochForTest = resetAiEnableEpochForTest;
async function readAiUserEnabled(host) {
    const st = await host.getStateAsync(ensure_states_1.AI_STATES.userEnabled);
    return st?.val === true;
}
exports.readAiUserEnabled = readAiUserEnabled;
/**
 * Publish nur wenn Nutzer weiterhin EIN will und die Request-Epoch unverändert ist.
 * OFF → ON während alter Request: Epoch hat sich zweimal geändert → alter Request bleibt ungültig.
 */
async function isAiPublishAllowed(host, requestEpoch) {
    if (requestEpoch !== currentAiEnableEpoch())
        return false;
    return readAiUserEnabled(host);
}
exports.isAiPublishAllowed = isAiPublishAllowed;
/**
 * Einmalige Migration native.ai_enabled → ai.user_enabled.
 * Markierung ai.user_enabled_migrated_v1 verhindert erneutes Seed nach State-Löschung.
 */
async function migrateAiUserEnabledOnce(host) {
    const migratedSt = await host.getStateAsync(ensure_states_1.AI_STATES.userEnabledMigratedV1);
    if (migratedSt?.val === true) {
        const enabled = await readAiUserEnabled(host);
        return { ran: false, userEnabled: enabled };
    }
    const c = host.config && typeof host.config === "object" ? host.config : {};
    const fromNative = (0, state_util_1.asBool)(c.ai_enabled) ?? false;
    await host.setStateAsync(ensure_states_1.AI_STATES.userEnabled, { val: fromNative, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.userEnabledMigratedV1, { val: true, ack: true });
    if (!fromNative) {
        await host.setStateAsync(ensure_states_1.AI_STATES.status, { val: "off", ack: true });
    }
    host.log?.info?.(`ai: migrated native.ai_enabled=${fromNative} → ai.user_enabled (once, migrated_v1)`);
    return { ran: true, userEnabled: fromNative };
}
exports.migrateAiUserEnabledOnce = migrateAiUserEnabledOnce;
/** Runtime-Toggle: ack schreiben, Epoch bumpen, bei OFF Status sofort „off“. */
async function applyAiUserEnabledToggle(host, enabled) {
    bumpAiEnableEpoch();
    await host.setStateAsync(ensure_states_1.AI_STATES.userEnabled, { val: enabled, ack: true });
    if (!enabled) {
        await host.setStateAsync(ensure_states_1.AI_STATES.status, { val: "off", ack: true });
    }
    host.log?.info?.(`ai: user_enabled → ${enabled} (epoch=${currentAiEnableEpoch()}, no restart)`);
}
exports.applyAiUserEnabledToggle = applyAiUserEnabledToggle;

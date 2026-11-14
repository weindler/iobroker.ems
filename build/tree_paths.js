"use strict";
/** Zentrale State-Pfade unter ems.&lt;instanz&gt; (Objektbaum-Schema v0.1). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_IDS = exports.AUDIT = exports.COMMAND = exports.GLOBAL = void 0;
exports.addonBase = addonBase;
exports.addonMode = addonMode;
exports.addonEnabled = addonEnabled;
exports.addonAvailable = addonAvailable;
exports.mappingBase = mappingBase;
exports.addonDryrunBase = addonDryrunBase;
exports.addonStatusBase = addonStatusBase;
exports.GLOBAL = {
    executionMode: "global.execution_mode",
};
exports.COMMAND = {
    inbox: "command.inbox",
    lastResult: "command.last_result",
};
exports.AUDIT = {
    lastEvent: "audit.last_event",
    addonLastEvent: (addonId) => `audit.${addonId}.last_event`,
};
function addonBase(addonId) {
    return `addons.${addonId}`;
}
function addonMode(addonId) {
    return `${addonBase(addonId)}.mode`;
}
function addonEnabled(addonId) {
    return `${addonBase(addonId)}.enabled`;
}
function addonAvailable(addonId) {
    return `${addonBase(addonId)}.available`;
}
/** Mapping nur unter addons.&lt;id&gt;.mapping.&lt;role&gt;.* */
function mappingBase(addonId, role) {
    return `${addonBase(addonId)}.mapping.${role}`;
}
function addonDryrunBase(addonId) {
    return `${addonBase(addonId)}.dryrun`;
}
function addonStatusBase(addonId) {
    return `${addonBase(addonId)}.status`;
}
/** Kanäle für übersichtlichen ioBroker-Objektbaum (ohne States). */
exports.CHANNEL_IDS = [
    "global",
    "ems_mirror",
    "command",
    "audit",
    "addons",
    "addons.wallbox",
    "addons.battery",
    "addons.immersion_heater",
    "addons.dynamic_tariff",
];

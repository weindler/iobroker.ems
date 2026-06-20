"use strict";
/** Zentrale State-Pfade unter ems.&lt;instanz&gt; (Objektbaum-Schema v0.1). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_IDS = exports.addonStatusBase = exports.addonDryrunBase = exports.mappingBase = exports.addonAvailable = exports.addonEnabled = exports.addonMode = exports.addonBase = exports.AUDIT = exports.COMMAND = exports.GLOBAL = void 0;
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
exports.addonBase = addonBase;
function addonMode(addonId) {
    return `${addonBase(addonId)}.mode`;
}
exports.addonMode = addonMode;
function addonEnabled(addonId) {
    return `${addonBase(addonId)}.enabled`;
}
exports.addonEnabled = addonEnabled;
function addonAvailable(addonId) {
    return `${addonBase(addonId)}.available`;
}
exports.addonAvailable = addonAvailable;
/** Mapping nur unter addons.&lt;id&gt;.mapping.&lt;role&gt;.* */
function mappingBase(addonId, role) {
    return `${addonBase(addonId)}.mapping.${role}`;
}
exports.mappingBase = mappingBase;
function addonDryrunBase(addonId) {
    return `${addonBase(addonId)}.dryrun`;
}
exports.addonDryrunBase = addonDryrunBase;
function addonStatusBase(addonId) {
    return `${addonBase(addonId)}.status`;
}
exports.addonStatusBase = addonStatusBase;
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

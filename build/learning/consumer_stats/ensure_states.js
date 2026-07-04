"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureConsumerStatsStates = exports.consumerStatsStateIds = exports.consumerStatsBase = void 0;
const state_util_1 = require("../../ems_light/state_util");
const tree_paths_1 = require("../../tree_paths");
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def, unit: id.endsWith("_kwh") ? "kWh" : "s" },
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
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
    };
}
function consumerStatsBase(addonId) {
    return `${(0, tree_paths_1.addonBase)(addonId)}.stats`;
}
exports.consumerStatsBase = consumerStatsBase;
function consumerStatsStateIds(addonId) {
    const base = consumerStatsBase(addonId);
    return {
        tracking: `${base}.tracking`,
        deviceActive: `${base}.device_active`,
        todayRuntimeSec: `${base}.today_runtime_sec`,
        todayEnergyKwh: `${base}.today_energy_kwh`,
        totalRuntimeSec: `${base}.total_runtime_sec`,
        totalEnergyKwh: `${base}.total_energy_kwh`,
        sessionRuntimeSec: `${base}.session_runtime_sec`,
        sessionEnergyKwh: `${base}.session_energy_kwh`,
        lastSessionRuntimeSec: `${base}.last_session_runtime_sec`,
        lastSessionEnergyKwh: `${base}.last_session_energy_kwh`,
        lastUpdated: `${base}.last_updated`,
    };
}
exports.consumerStatsStateIds = consumerStatsStateIds;
const CONSUMER_LABELS = {
    immersion_heater: "Heizstab",
};
async function ensureConsumerStatsStates(host, addonId) {
    const label = CONSUMER_LABELS[addonId] ?? addonId;
    const base = consumerStatsBase(addonId);
    const ids = consumerStatsStateIds(addonId);
    await (0, state_util_1.ensureChannel)(host, base, `${label} Statistik`);
    const defs = [
        boolState(ids.tracking, `${label} Statistik aktiv`, false),
        boolState(ids.deviceActive, `${label} läuft (EMS)`, false),
        numState(ids.todayRuntimeSec, `${label} Laufzeit heute`, 0),
        numState(ids.todayEnergyKwh, `${label} Verbrauch heute`, 0),
        numState(ids.totalRuntimeSec, `${label} Laufzeit gesamt`, 0),
        numState(ids.totalEnergyKwh, `${label} Verbrauch gesamt`, 0),
        numState(ids.sessionRuntimeSec, `${label} aktuelle Session Laufzeit`, 0),
        numState(ids.sessionEnergyKwh, `${label} aktuelle Session Verbrauch`, 0),
        numState(ids.lastSessionRuntimeSec, `${label} letzte Session Laufzeit`, 0),
        numState(ids.lastSessionEnergyKwh, `${label} letzte Session Verbrauch`, 0),
        strState(ids.lastUpdated, `${label} Statistik aktualisiert`, ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureConsumerStatsStates = ensureConsumerStatsStates;

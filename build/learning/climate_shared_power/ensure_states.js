"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishClimateSharedPowerStat = exports.ensureClimateSharedPowerStatesForSlug = exports.ensureClimateSharedPowerRootStates = exports.climateSharedPowerStateIdsForSlug = exports.climateSharedPowerBaseForSlug = exports.climateSharedPowerStateSlug = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name, unit) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, unit },
        defaultVal: null,
    };
}
function strState(id, name) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false },
        defaultVal: "",
    };
}
/** Stabile, ioBroker-taugliche ID aus Gruppe/Modus/Kombination (keine Sonderzeichen außer `_`). */
function climateSharedPowerStateSlug(groupId, mode, combo) {
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return `${clean(groupId)}_${clean(mode)}_${clean(combo.replace(/\+/g, "p"))}`;
}
exports.climateSharedPowerStateSlug = climateSharedPowerStateSlug;
function climateSharedPowerBaseForSlug(slug) {
    return `learning.climate_shared_power.${slug}`;
}
exports.climateSharedPowerBaseForSlug = climateSharedPowerBaseForSlug;
function climateSharedPowerStateIdsForSlug(slug) {
    const base = climateSharedPowerBaseForSlug(slug);
    return {
        medianPowerW: `${base}.median_power_w`,
        p75PowerW: `${base}.p75_power_w`,
        spreadW: `${base}.spread_w`,
        sampleCount: `${base}.sample_count`,
        confidence: `${base}.confidence_pct`,
        ageDays: `${base}.age_days`,
        lastSampleAt: `${base}.last_sample_at`,
    };
}
exports.climateSharedPowerStateIdsForSlug = climateSharedPowerStateIdsForSlug;
async function ensureClimateSharedPowerRootStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.climate_shared_power", "EMS-Light Klima Shared-Power Learning");
    await (0, state_util_1.ensureStates)(host, [
        strState("learning.climate_shared_power.summary_de", "Klima Shared-Power Kurzfassung"),
        numState("learning.climate_shared_power.combinations_count", "Klima Shared-Power Kombinationen"),
    ]);
}
exports.ensureClimateSharedPowerRootStates = ensureClimateSharedPowerRootStates;
async function ensureClimateSharedPowerStatesForSlug(host, slug, label) {
    const base = climateSharedPowerBaseForSlug(slug);
    const ids = climateSharedPowerStateIdsForSlug(slug);
    await (0, state_util_1.ensureChannel)(host, base, `Klima Shared-Power ${label}`);
    await (0, state_util_1.ensureStates)(host, [
        numState(ids.medianPowerW, `${label} Median-Leistung`, "W"),
        numState(ids.p75PowerW, `${label} p75-Leistung (Planner-Wert)`, "W"),
        numState(ids.spreadW, `${label} Streuung (IQR)`, "W"),
        numState(ids.sampleCount, `${label} Sample-Anzahl`),
        numState(ids.confidence, `${label} Confidence`, "%"),
        numState(ids.ageDays, `${label} Alter letzte Probe`, "d"),
        strState(ids.lastSampleAt, `${label} letzte Probe`),
    ]);
}
exports.ensureClimateSharedPowerStatesForSlug = ensureClimateSharedPowerStatesForSlug;
async function publishClimateSharedPowerStat(host, slug, stat) {
    const ids = climateSharedPowerStateIdsForSlug(slug);
    await host.setStateAsync(ids.medianPowerW, { val: stat.medianPowerW, ack: true });
    await host.setStateAsync(ids.p75PowerW, { val: stat.p75PowerW, ack: true });
    await host.setStateAsync(ids.spreadW, { val: stat.spreadW, ack: true });
    await host.setStateAsync(ids.sampleCount, { val: stat.sampleCount, ack: true });
    await host.setStateAsync(ids.confidence, { val: Math.round(stat.confidence * 100), ack: true });
    await host.setStateAsync(ids.ageDays, { val: stat.ageDays, ack: true });
    await host.setStateAsync(ids.lastSampleAt, { val: stat.lastSampleAtIso ?? "", ack: true });
}
exports.publishClimateSharedPowerStat = publishClimateSharedPowerStat;

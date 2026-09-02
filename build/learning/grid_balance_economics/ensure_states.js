"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureGridBalanceEconomicsStates = exports.GRID_BALANCE_ECONOMICS_STATE_IDS = void 0;
const state_util_1 = require("../../ems_light/state_util");
const BASE = "learning.grid_balance_economics";
exports.GRID_BALANCE_ECONOMICS_STATE_IDS = {
    status: `${BASE}.status`,
    lastRun: `${BASE}.last_run`,
    usable: `${BASE}.usable`,
    alpha: `${BASE}.alpha`,
    beta: `${BASE}.beta`,
    confidence: `${BASE}.confidence`,
    pairCount: `${BASE}.pair_count`,
    reasonDe: `${BASE}.reason_de`,
    etaPvPath: `${BASE}.eta_pv_path`,
    etaGridPath: `${BASE}.eta_grid_path`,
    etaPvUsable: `${BASE}.eta_pv_usable`,
    etaGridUsable: `${BASE}.eta_grid_usable`,
    etaReasonDe: `${BASE}.eta_reason_de`,
};
function numState(id, name) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false } };
}
function strState(id, name, def = "") {
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
async function ensureGridBalanceEconomicsStates(host) {
    await (0, state_util_1.ensureChannel)(host, BASE, "EMS-Light Learning Grid-Balance-Economics");
    const S = exports.GRID_BALANCE_ECONOMICS_STATE_IDS;
    await (0, state_util_1.ensureStates)(host, [
        strState(S.status, "GB-Economics Status", "not_initialized"),
        strState(S.lastRun, "GB-Economics letzter Lauf (ISO)"),
        boolState(S.usable, "GB-Economics belastbar", false),
        numState(S.alpha, "GB-Economics α (vermiedener Import / GB-kWh)"),
        numState(S.beta, "GB-Economics β (extra Batterie / GB-kWh)"),
        numState(S.confidence, "GB-Economics Confidence"),
        numState(S.pairCount, "GB-Economics Vergleichspaare"),
        strState(S.reasonDe, "GB-Economics Begründung"),
        numState(S.etaPvPath, "GB-Economics η PV-Pfad"),
        numState(S.etaGridPath, "GB-Economics η Netz-Pfad"),
        boolState(S.etaPvUsable, "GB-Economics η PV usable", false),
        boolState(S.etaGridUsable, "GB-Economics η Netz usable", false),
        strState(S.etaReasonDe, "GB-Economics η Begründung"),
    ]);
}
exports.ensureGridBalanceEconomicsStates = ensureGridBalanceEconomicsStates;

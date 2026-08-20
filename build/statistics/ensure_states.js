"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStatisticsStateTree = exports.STATISTICS_STATES = exports.STATISTICS_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
exports.STATISTICS_BASE = "statistics";
exports.STATISTICS_STATES = {
    enabled: `${exports.STATISTICS_BASE}.enabled`,
    lastRunAt: `${exports.STATISTICS_BASE}.last_run_at`,
    reasonDe: `${exports.STATISTICS_BASE}.reason_de`,
    configJson: `${exports.STATISTICS_BASE}.config_json`,
    homeTodayJson: `${exports.STATISTICS_BASE}.home.today_json`,
    homeMonthJson: `${exports.STATISTICS_BASE}.home.month_json`,
    mobilityTodayJson: `${exports.STATISTICS_BASE}.mobility.today_json`,
    mobilityMonthJson: `${exports.STATISTICS_BASE}.mobility.month_json`,
    homeTodaySavingsEur: `${exports.STATISTICS_BASE}.home.today_savings_vs_fixed_eur`,
    homeMonthSavingsEur: `${exports.STATISTICS_BASE}.home.month_savings_vs_fixed_eur`,
    mobilityTodaySavingsEur: `${exports.STATISTICS_BASE}.mobility.today_savings_vs_ice_eur`,
    mobilityMonthSavingsEur: `${exports.STATISTICS_BASE}.mobility.month_savings_vs_ice_eur`,
    publicPendingJson: `${exports.STATISTICS_BASE}.public_charge.pending_json`,
    publicSubmitRequest: `${exports.STATISTICS_BASE}.public_charge.submit_request`,
    publicSubmitAckDe: `${exports.STATISTICS_BASE}.public_charge.submit_ack_de`,
};
function numState(id, name, unit) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: "value",
            read: true,
            write: false,
            def: null,
            ...(unit ? { unit } : {}),
        },
        defaultVal: null,
        setDefaultIfEmpty: true,
    };
}
function strState(id, name, def = "") {
    return {
        id,
        common: {
            name,
            type: "string",
            role: "text",
            read: true,
            write: false,
            def,
        },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: {
            name,
            type: "boolean",
            role: "indicator",
            read: true,
            write: false,
            def,
        },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensureStatisticsStateTree(host) {
    await (0, state_util_1.ensureChannel)(host, exports.STATISTICS_BASE, "EMS-Light Statistik (Reporting)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.home`, "Statistik Haus / Tarifvergleich");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.mobility`, "Statistik Mobilität E-Auto vs. Verbrenner");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.public_charge`, "Statistik Schnellader / manuelle Rechnung");
    await (0, state_util_1.ensureStates)(host, [
        boolState(exports.STATISTICS_STATES.enabled, "Statistik-Sidecar aktiv", true),
        strState(exports.STATISTICS_STATES.lastRunAt, "Statistik letzter Lauf (ISO)"),
        strState(exports.STATISTICS_STATES.reasonDe, "Statistik Hinweis (DE)", "Noch kein Lauf."),
        strState(exports.STATISTICS_STATES.configJson, "Statistik wirksame Config (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.homeTodayJson, "Haus heute Vergleich (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.homeMonthJson, "Haus Monat Vergleich (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.mobilityTodayJson, "Mobilität heute (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.mobilityMonthJson, "Mobilität Monat (JSON)", "{}"),
        numState(exports.STATISTICS_STATES.homeTodaySavingsEur, "Haus heute Ersparnis vs. Festtarif", "EUR"),
        numState(exports.STATISTICS_STATES.homeMonthSavingsEur, "Haus Monat Ersparnis vs. Festtarif", "EUR"),
        numState(exports.STATISTICS_STATES.mobilityTodaySavingsEur, "Mobilität heute Ersparnis vs. Verbrenner", "EUR"),
        numState(exports.STATISTICS_STATES.mobilityMonthSavingsEur, "Mobilität Monat Ersparnis vs. Verbrenner", "EUR"),
        strState(exports.STATISTICS_STATES.publicPendingJson, "Offene Schnellader-Sessions (JSON)", "[]"),
        {
            id: exports.STATISTICS_STATES.publicSubmitRequest,
            common: {
                name: "Schnellader-Rechnung einreichen (JSON ack:false)",
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "",
            },
            defaultVal: "",
            setDefaultIfEmpty: true,
        },
        strState(exports.STATISTICS_STATES.publicSubmitAckDe, "Schnellader-Rechnung Bestätigung (DE)"),
    ]);
}
exports.ensureStatisticsStateTree = ensureStatisticsStateTree;

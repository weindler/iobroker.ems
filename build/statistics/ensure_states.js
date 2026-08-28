"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureStatisticsStateTree = exports.STATISTICS_STATES = exports.STATISTICS_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
const flat_states_1 = require("./flat_states");
exports.STATISTICS_BASE = "statistics";
exports.STATISTICS_STATES = {
    enabled: `${exports.STATISTICS_BASE}.enabled`,
    lastRunAt: `${exports.STATISTICS_BASE}.last_run_at`,
    reasonDe: `${exports.STATISTICS_BASE}.reason_de`,
    configJson: `${exports.STATISTICS_BASE}.config_json`,
    homeTodayJson: `${exports.STATISTICS_BASE}.home.today_json`,
    homeMonthJson: `${exports.STATISTICS_BASE}.home.month_json`,
    homePeriodJson: `${exports.STATISTICS_BASE}.home.period_json`,
    mobilityTodayJson: `${exports.STATISTICS_BASE}.mobility.today_json`,
    mobilityMonthJson: `${exports.STATISTICS_BASE}.mobility.month_json`,
    mobilityPeriodJson: `${exports.STATISTICS_BASE}.mobility.period_json`,
    homeTodaySavingsEur: `${exports.STATISTICS_BASE}.home.today_savings_vs_fixed_eur`,
    homeMonthSavingsEur: `${exports.STATISTICS_BASE}.home.month_savings_vs_fixed_eur`,
    homePeriodSavingsEur: `${exports.STATISTICS_BASE}.home.period_savings_vs_fixed_eur`,
    mobilityTodaySavingsEur: `${exports.STATISTICS_BASE}.mobility.today_savings_vs_ice_eur`,
    mobilityMonthSavingsEur: `${exports.STATISTICS_BASE}.mobility.month_savings_vs_ice_eur`,
    mobilityPeriodSavingsEur: `${exports.STATISTICS_BASE}.mobility.period_savings_vs_ice_eur`,
    periodId: `${exports.STATISTICS_BASE}.period_id`,
    periodOptionsJson: `${exports.STATISTICS_BASE}.period_options_json`,
    publicPendingJson: `${exports.STATISTICS_BASE}.public_charge.pending_json`,
    publicSubmitRequest: `${exports.STATISTICS_BASE}.public_charge.submit_request`,
    publicSubmitAckDe: `${exports.STATISTICS_BASE}.public_charge.submit_ack_de`,
    adjustRequest: `${exports.STATISTICS_BASE}.adjust_request`,
    adjustAckDe: `${exports.STATISTICS_BASE}.adjust_ack_de`,
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
function homeFlatStates(ids, scopeDe) {
    return [
        numState(ids.gridImportKwh, `Haus ${scopeDe} Netzbezug`, "kWh"),
        numState(ids.tibberEur, `Haus ${scopeDe} Tibber`, "EUR"),
        numState(ids.fixedEur, `Haus ${scopeDe} Festtarif`, "EUR"),
        numState(ids.rewardsEur, `Haus ${scopeDe} Rewards`, "EUR"),
        strState(ids.rewardsSource, `Haus ${scopeDe} Rewards-Quelle`),
        numState(ids.savingsEur, `Haus ${scopeDe} Ersparnis vs. Festtarif`, "EUR"),
        strState(ids.labelDe, `Haus ${scopeDe} Label`),
        strState(ids.fromKey, `Haus ${scopeDe} von (YYYY-MM-DD)`),
        strState(ids.toKey, `Haus ${scopeDe} bis (YYYY-MM-DD)`),
    ];
}
function mobilityFlatStates(ids, scopeDe) {
    return [
        numState(ids.homePvKwh, `Mobilität ${scopeDe} Heim PV`, "kWh"),
        numState(ids.homeGridKwh, `Mobilität ${scopeDe} Heim Netz`, "kWh"),
        numState(ids.homeGridCostEur, `Mobilität ${scopeDe} Heim Netz brutto`, "EUR"),
        numState(ids.homeGridCostNetEur, `Mobilität ${scopeDe} Heim Netz netto`, "EUR"),
        numState(ids.publicInvoicedKwh, `Mobilität ${scopeDe} Schnellader`, "kWh"),
        numState(ids.estimatedKm, `Mobilität ${scopeDe} km ≈`, "km"),
        numState(ids.evCostEur, `Mobilität ${scopeDe} E-Auto`, "EUR"),
        numState(ids.iceCostEur, `Mobilität ${scopeDe} Verbrenner`, "EUR"),
        numState(ids.fuelPriceEurPerL, `Mobilität ${scopeDe} Sprit`, "EUR/l"),
        numState(ids.savingsEur, `Mobilität ${scopeDe} Ersparnis vs. Verbrenner`, "EUR"),
        strState(ids.rewardsSource, `Mobilität ${scopeDe} Rewards-Quelle`),
        strState(ids.labelDe, `Mobilität ${scopeDe} Label`),
        strState(ids.fromKey, `Mobilität ${scopeDe} von (YYYY-MM-DD)`),
        strState(ids.toKey, `Mobilität ${scopeDe} bis (YYYY-MM-DD)`),
    ];
}
async function ensureStatisticsStateTree(host) {
    await (0, state_util_1.ensureChannel)(host, exports.STATISTICS_BASE, "EMS-Light Statistik (Reporting)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.home`, "Statistik Haus / Tarifvergleich");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.home.today`, "Haus heute (flache States)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.home.period`, "Haus Periode (flache States)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.mobility`, "Statistik Mobilität E-Auto vs. Verbrenner");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.mobility.today`, "Mobilität heute (flache States)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.mobility.period`, "Mobilität Periode (flache States)");
    await (0, state_util_1.ensureChannel)(host, `${exports.STATISTICS_BASE}.public_charge`, "Statistik Schnellader / manuelle Rechnung");
    await (0, state_util_1.ensureStates)(host, [
        boolState(exports.STATISTICS_STATES.enabled, "Statistik-Sidecar aktiv", true),
        strState(exports.STATISTICS_STATES.lastRunAt, "Statistik letzter Lauf (ISO)"),
        strState(exports.STATISTICS_STATES.reasonDe, "Statistik Hinweis (DE)", "Noch kein Lauf."),
        strState(exports.STATISTICS_STATES.configJson, "Statistik wirksame Config (JSON)", "{}"),
        strState(flat_states_1.STATISTICS_FLAT.statisticsStartDate, "Wirksames Statistik-Startdatum (YYYY-MM-DD)"),
        strState(exports.STATISTICS_STATES.homeTodayJson, "Haus heute Vergleich (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.homeMonthJson, "Haus Monat Vergleich (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.homePeriodJson, "Haus Periode Vergleich (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.mobilityTodayJson, "Mobilität heute (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.mobilityMonthJson, "Mobilität Monat (JSON)", "{}"),
        strState(exports.STATISTICS_STATES.mobilityPeriodJson, "Mobilität Periode Vergleich (JSON)", "{}"),
        numState(exports.STATISTICS_STATES.homeTodaySavingsEur, "Haus heute Ersparnis vs. Festtarif (Legacy)", "EUR"),
        numState(exports.STATISTICS_STATES.homeMonthSavingsEur, "Haus Monat Ersparnis vs. Festtarif (Legacy)", "EUR"),
        numState(exports.STATISTICS_STATES.homePeriodSavingsEur, "Haus Periode Ersparnis vs. Festtarif (Legacy)", "EUR"),
        numState(exports.STATISTICS_STATES.mobilityTodaySavingsEur, "Mobilität heute Ersparnis vs. Verbrenner (Legacy)", "EUR"),
        numState(exports.STATISTICS_STATES.mobilityMonthSavingsEur, "Mobilität Monat Ersparnis vs. Verbrenner (Legacy)", "EUR"),
        numState(exports.STATISTICS_STATES.mobilityPeriodSavingsEur, "Mobilität Periode Ersparnis vs. Verbrenner (Legacy)", "EUR"),
        ...homeFlatStates(flat_states_1.STATISTICS_FLAT.homeToday, "heute"),
        ...homeFlatStates(flat_states_1.STATISTICS_FLAT.homePeriod, "Periode"),
        ...mobilityFlatStates(flat_states_1.STATISTICS_FLAT.mobilityToday, "heute"),
        ...mobilityFlatStates(flat_states_1.STATISTICS_FLAT.mobilityPeriod, "Periode"),
        {
            id: exports.STATISTICS_STATES.periodId,
            common: {
                name: "Statistik Zeitraum (z. B. this_month, last_7_days)",
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "this_month",
            },
            defaultVal: "this_month",
            setDefaultIfEmpty: true,
        },
        strState(exports.STATISTICS_STATES.periodOptionsJson, "Statistik Zeitraum-Optionen (JSON)", "[]"),
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
        {
            id: exports.STATISTICS_STATES.adjustRequest,
            common: {
                name: "Statistik korrigieren / Startwerte (JSON ack:false)",
                type: "string",
                role: "text",
                read: true,
                write: true,
                def: "",
            },
            defaultVal: "",
            setDefaultIfEmpty: true,
        },
        strState(exports.STATISTICS_STATES.adjustAckDe, "Statistik Korrektur Bestätigung (DE)"),
    ]);
}
exports.ensureStatisticsStateTree = ensureStatisticsStateTree;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEconomicsStates = exports.ECONOMICS_FLAT = exports.ECONOMICS_STATES = void 0;
const state_util_1 = require("../ems_light/state_util");
function numState(id, name, unit) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}
function strState(id, name, def) {
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
exports.ECONOMICS_STATES = {
    enabled: "economics.enabled",
    lastRunAt: "economics.last_run_at",
    reasonDe: "economics.reason_de",
    periodId: "economics.period_id",
};
/** Flache Kennzahlen fürs Betriebsseiten-Dashboard — kein JSON-Parsing in der einfachen VIS-Ansicht. */
exports.ECONOMICS_FLAT = {
    todayTarifvorteilEur: "economics.today.tarifvorteil_eur",
    todayEmsVorteilEur: "economics.today.ems_vorteil_eur",
    todayKiMehrwertEur: "economics.today.ki_mehrwert_eur",
    todayGridRewardsEur: "economics.today.grid_rewards_eur",
    periodTarifvorteilEur: "economics.period.tarifvorteil_eur",
    periodEmsVorteilEur: "economics.period.ems_vorteil_eur",
    periodKiMehrwertEur: "economics.period.ki_mehrwert_eur",
    periodGridRewardsEur: "economics.period.grid_rewards_eur",
    periodLabelDe: "economics.period.label_de",
    cumulativeTarifvorteilEur: "economics.cumulative.tarifvorteil_eur",
    cumulativeEmsVorteilEur: "economics.cumulative.ems_vorteil_eur",
    cumulativeKiMehrwertEur: "economics.cumulative.ki_mehrwert_eur",
    cumulativeGridRewardsEur: "economics.cumulative.grid_rewards_eur",
};
async function ensureEconomicsStates(host) {
    await (0, state_util_1.ensureChannel)(host, "economics", "EMS-Light Wirtschaftlichkeit (Phase 7)");
    await (0, state_util_1.ensureChannel)(host, "economics.today", "Wirtschaftlichkeit heute");
    await (0, state_util_1.ensureChannel)(host, "economics.period", "Wirtschaftlichkeit Zeitraum");
    await (0, state_util_1.ensureChannel)(host, "economics.cumulative", "Wirtschaftlichkeit kumuliert (seit Statistik-Start)");
    const defs = [
        boolState(exports.ECONOMICS_STATES.enabled, "Wirtschaftlichkeit aktiv"),
        strState(exports.ECONOMICS_STATES.lastRunAt, "Wirtschaftlichkeit letzter Lauf (ISO)"),
        strState(exports.ECONOMICS_STATES.reasonDe, "Wirtschaftlichkeit Status/Begründung", ""),
        strState(exports.ECONOMICS_STATES.periodId, "Wirtschaftlichkeit Zeitraum-Auswahl", "this_month"),
        numState(exports.ECONOMICS_FLAT.todayTarifvorteilEur, "Tarifvorteil heute", "EUR"),
        numState(exports.ECONOMICS_FLAT.todayEmsVorteilEur, "EMS-Vorteil heute", "EUR"),
        numState(exports.ECONOMICS_FLAT.todayKiMehrwertEur, "KI-Mehrwert heute", "EUR"),
        numState(exports.ECONOMICS_FLAT.todayGridRewardsEur, "Grid Rewards heute", "EUR"),
        numState(exports.ECONOMICS_FLAT.periodTarifvorteilEur, "Tarifvorteil Zeitraum", "EUR"),
        numState(exports.ECONOMICS_FLAT.periodEmsVorteilEur, "EMS-Vorteil Zeitraum", "EUR"),
        numState(exports.ECONOMICS_FLAT.periodKiMehrwertEur, "KI-Mehrwert Zeitraum", "EUR"),
        numState(exports.ECONOMICS_FLAT.periodGridRewardsEur, "Grid Rewards Zeitraum", "EUR"),
        strState(exports.ECONOMICS_FLAT.periodLabelDe, "Zeitraum-Bezeichnung", ""),
        numState(exports.ECONOMICS_FLAT.cumulativeTarifvorteilEur, "Tarifvorteil kumuliert", "EUR"),
        numState(exports.ECONOMICS_FLAT.cumulativeEmsVorteilEur, "EMS-Vorteil kumuliert", "EUR"),
        numState(exports.ECONOMICS_FLAT.cumulativeKiMehrwertEur, "KI-Mehrwert kumuliert", "EUR"),
        numState(exports.ECONOMICS_FLAT.cumulativeGridRewardsEur, "Grid Rewards kumuliert", "EUR"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureEconomicsStates = ensureEconomicsStates;

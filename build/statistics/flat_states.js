"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishMobilityFlat = exports.publishHomeFlat = exports.STATISTICS_FLAT = void 0;
/** Flache Objektbaum-States (Hybrid: JSON + Einzelwerte). */
exports.STATISTICS_FLAT = {
    homeToday: {
        gridImportKwh: "statistics.home.today.grid_import_kwh",
        tibberEur: "statistics.home.today.tibber_eur",
        fixedEur: "statistics.home.today.fixed_eur",
        rewardsEur: "statistics.home.today.rewards_eur",
        rewardsSource: "statistics.home.today.rewards_source",
        savingsEur: "statistics.home.today.savings_eur",
        labelDe: "statistics.home.today.label_de",
        fromKey: "statistics.home.today.from_key",
        toKey: "statistics.home.today.to_key",
    },
    homePeriod: {
        gridImportKwh: "statistics.home.period.grid_import_kwh",
        tibberEur: "statistics.home.period.tibber_eur",
        fixedEur: "statistics.home.period.fixed_eur",
        rewardsEur: "statistics.home.period.rewards_eur",
        rewardsSource: "statistics.home.period.rewards_source",
        savingsEur: "statistics.home.period.savings_eur",
        labelDe: "statistics.home.period.label_de",
        fromKey: "statistics.home.period.from_key",
        toKey: "statistics.home.period.to_key",
    },
    mobilityToday: {
        homePvKwh: "statistics.mobility.today.home_pv_kwh",
        homeGridKwh: "statistics.mobility.today.home_grid_kwh",
        homeGridCostEur: "statistics.mobility.today.home_grid_cost_eur",
        homeGridCostNetEur: "statistics.mobility.today.home_grid_cost_net_eur",
        publicInvoicedKwh: "statistics.mobility.today.public_invoiced_kwh",
        estimatedKm: "statistics.mobility.today.estimated_km",
        evCostEur: "statistics.mobility.today.ev_cost_eur",
        iceCostEur: "statistics.mobility.today.ice_cost_eur",
        fuelPriceEurPerL: "statistics.mobility.today.fuel_price_eur_per_l",
        savingsEur: "statistics.mobility.today.savings_eur",
        rewardsSource: "statistics.mobility.today.rewards_source",
        labelDe: "statistics.mobility.today.label_de",
        fromKey: "statistics.mobility.today.from_key",
        toKey: "statistics.mobility.today.to_key",
    },
    mobilityPeriod: {
        homePvKwh: "statistics.mobility.period.home_pv_kwh",
        homeGridKwh: "statistics.mobility.period.home_grid_kwh",
        homeGridCostEur: "statistics.mobility.period.home_grid_cost_eur",
        homeGridCostNetEur: "statistics.mobility.period.home_grid_cost_net_eur",
        publicInvoicedKwh: "statistics.mobility.period.public_invoiced_kwh",
        estimatedKm: "statistics.mobility.period.estimated_km",
        evCostEur: "statistics.mobility.period.ev_cost_eur",
        iceCostEur: "statistics.mobility.period.ice_cost_eur",
        fuelPriceEurPerL: "statistics.mobility.period.fuel_price_eur_per_l",
        savingsEur: "statistics.mobility.period.savings_eur",
        rewardsSource: "statistics.mobility.period.rewards_source",
        labelDe: "statistics.mobility.period.label_de",
        fromKey: "statistics.mobility.period.from_key",
        toKey: "statistics.mobility.period.to_key",
    },
    statisticsStartDate: "statistics.statistics_start_date",
};
function n(v) {
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}
async function publishHomeFlat(set, ids, sum, labelFallback) {
    await set(ids.gridImportKwh, n(sum.gridImportKwh));
    await set(ids.tibberEur, n(sum.dynamicCostEur));
    await set(ids.fixedEur, n(sum.fixedTariffCostEur));
    await set(ids.rewardsEur, n(sum.gridRewardsCreditEur));
    await set(ids.rewardsSource, sum.gridRewardsSource ?? "off");
    await set(ids.savingsEur, n(sum.savingsVsFixedEur));
    await set(ids.labelDe, sum.periodLabelDe || labelFallback);
    await set(ids.fromKey, sum.fromKey ?? "");
    await set(ids.toKey, sum.toKey ?? "");
}
exports.publishHomeFlat = publishHomeFlat;
async function publishMobilityFlat(set, ids, sum, labelFallback) {
    await set(ids.homePvKwh, n(sum.homePvKwh));
    await set(ids.homeGridKwh, n(sum.homeGridKwh));
    await set(ids.homeGridCostEur, n(sum.homeGridCostEur));
    await set(ids.homeGridCostNetEur, n(sum.homeGridCostNetEur));
    await set(ids.publicInvoicedKwh, n(sum.publicInvoicedKwh));
    await set(ids.estimatedKm, n(sum.estimatedKm));
    await set(ids.evCostEur, n(sum.evTotalCostEur));
    await set(ids.iceCostEur, n(sum.iceCostEur));
    await set(ids.fuelPriceEurPerL, n(sum.fuelPriceEurPerL));
    await set(ids.savingsEur, n(sum.savingsVsIceEur));
    await set(ids.rewardsSource, sum.gridRewardsSource ?? "off");
    await set(ids.labelDe, sum.periodLabelDe || labelFallback);
    await set(ids.fromKey, sum.fromKey ?? "");
    await set(ids.toKey, sum.toKey ?? "");
}
exports.publishMobilityFlat = publishMobilityFlat;

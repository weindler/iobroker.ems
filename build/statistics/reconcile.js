"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileMobilityEnergy = exports.reconcileHomeEnergy = void 0;
/** Netzmenge des Smart Meters ist die sichtbare Bezugsbasis; abweichende Tibber-Perioden bleiben markiert. */
function reconcileHomeEnergy(home, energy) {
    if (!energy || energy.gridImportKwh === null)
        return home;
    const same = home.gridImportKwh !== null && Math.abs(home.gridImportKwh - energy.gridImportKwh) <= 0.05;
    const exportSame = home.gridExportKwh != null && energy.gridExportKwh !== null &&
        Math.abs(home.gridExportKwh - energy.gridExportKwh) <= 0.05;
    return {
        ...home,
        gridImportKwh: energy.gridImportKwh,
        gridExportKwh: energy.gridExportKwh,
        feedInCreditEur: exportSame ? home.feedInCreditEur : null,
        fixedTariffCostEur: same ? home.fixedTariffCostEur : null,
        savingsVsFixedEur: same ? home.savingsVsFixedEur : null,
        reasonDe: (same
            ? "Netzbezug und Tibber-Kosten verwenden dieselbe gemessene Menge. "
            : "Smart-Meter-Netzbezug und Tibber-Kosten beziehen sich auf unterschiedliche Erfassungsstände; Festtarifvergleich bis zum gemeinsamen Datenstand derzeit nicht berechenbar. ") + home.reasonDe,
    };
}
exports.reconcileHomeEnergy = reconcileHomeEnergy;
/** Dieselbe Wallboxmessung für Energie- und Mobilitätskarte verwenden. */
function reconcileMobilityEnergy(mobility, energy) {
    if (!energy || energy.evChargedKwh === null) {
        return {
            ...mobility,
            homeChargedKwh: null,
            homePvKwh: null,
            homeBatteryKwh: null,
            homeGridKwh: null,
            estimatedKm: null,
            evTotalCostEur: null,
            iceCostEur: null,
            savingsVsIceEur: null,
            reasonDe: "Gemessene Wallboxenergie für diesen Zeitraum noch nicht verfügbar. " + mobility.reasonDe,
        };
    }
    const measured = energy.evChargedKwh;
    const legacy = (mobility.homePvKwh ?? 0) + (mobility.homeGridKwh ?? 0);
    const sameEnergy = Math.abs(measured - legacy) <= 0.05;
    const onlyFast = energy.evFastChargedKwh !== null && Math.abs(measured - energy.evFastChargedKwh) <= 0.05;
    const sourcesComplete = onlyFast && energy.evFastBatteryKwh !== null &&
        energy.evFastGridKwh !== null && energy.evFastLocalKwh !== null;
    const homeGridKwh = sourcesComplete ? energy.evFastGridKwh : null;
    const homeBatteryKwh = sourcesComplete ? energy.evFastBatteryKwh : null;
    const homePvKwh = energy.evPvKwh;
    const sourceMatchesLegacy = sourcesComplete && homeGridKwh !== null && homePvKwh !== null &&
        Math.abs(homeGridKwh - (mobility.homeGridKwh ?? 0)) <= 0.05 &&
        Math.abs(homePvKwh - (mobility.homePvKwh ?? 0)) <= 0.05;
    const costsKnown = sameEnergy && sourceMatchesLegacy;
    const chargedWithInvoice = measured + (mobility.publicInvoicedKwh ?? 0);
    const estimatedKm = mobility.evKwhPer100Km && mobility.evKwhPer100Km > 0
        ? Math.round((chargedWithInvoice / mobility.evKwhPer100Km) * 100_000) / 1000
        : null;
    return {
        ...mobility,
        homeChargedKwh: measured,
        homePvKwh,
        homeBatteryKwh,
        homeGridKwh,
        homeGridCostEur: costsKnown ? mobility.homeGridCostEur : null,
        homeGridCostNetEur: costsKnown ? mobility.homeGridCostNetEur : null,
        estimatedKm,
        evTotalCostEur: costsKnown ? mobility.evTotalCostEur : null,
        iceCostEur: costsKnown ? mobility.iceCostEur : null,
        savingsVsIceEur: costsKnown ? mobility.savingsVsIceEur : null,
        reasonDe: (!sameEnergy || !sourceMatchesLegacy
            ? "Wallboxenergie stammt aus der Tages-Telemetrie; Herkunft oder Kosten der bisherigen Sitzungszählung weichen ab. Unbelegte Anteile und Ersparnis bleiben offen. "
            : "Wallboxenergie und Sitzungszählung stimmen überein. ") + mobility.reasonDe,
    };
}
exports.reconcileMobilityEnergy = reconcileMobilityEnergy;

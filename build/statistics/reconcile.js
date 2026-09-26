"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileMobilityEnergy = exports.reconcileHomeEnergy = void 0;
const compute_1 = require("./compute");
/** Netzmenge des Smart Meters ist die sichtbare Bezugsbasis; abweichende Tibber-Perioden bleiben markiert. */
function reconcileHomeEnergy(home, energy, options = {}) {
    if (!energy || energy.gridImportKwh === null)
        return home;
    const same = home.gridImportKwh !== null && Math.abs(home.gridImportKwh - energy.gridImportKwh) <= 0.05;
    const separateTibberComparison = !same && options.preserveTibberMonthlyComparison === true &&
        home.gridImportKwh !== null && home.dynamicCostEur !== null &&
        home.fixedTariffCostEur !== null && home.savingsVsFixedEur !== null;
    const exportSame = home.gridExportKwh != null && energy.gridExportKwh !== null &&
        Math.abs(home.gridExportKwh - energy.gridExportKwh) <= 0.05;
    const meterFeedInCredit = energy.gridExportKwh !== null && energy.gridExportKwh >= 0 &&
        options.feedInCtPerKwh != null && options.feedInCtPerKwh >= 0
        ? Math.round(energy.gridExportKwh * options.feedInCtPerKwh) / 100 : null;
    return {
        ...home,
        gridImportKwh: energy.gridImportKwh,
        comparisonGridImportKwh: separateTibberComparison ? home.gridImportKwh : null,
        gridExportKwh: energy.gridExportKwh,
        feedInCreditEur: meterFeedInCredit ?? (exportSame ? home.feedInCreditEur : null),
        fixedTariffCostEur: same || separateTibberComparison ? home.fixedTariffCostEur : null,
        savingsVsFixedEur: same || separateTibberComparison ? home.savingsVsFixedEur : null,
        reasonDe: (same
            ? "Netzbezug und Tibber-Kosten verwenden dieselbe gemessene Menge. "
            : separateTibberComparison
                ? "Vorläufiger Preisvergleich auf Tibbers Monatsmenge; der Smart-Meter-Wert hat einen anderen Erfassungsstand. Beide Mengen werden getrennt ausgewiesen. "
                : "Smart-Meter-Netzbezug und Tibber-Kosten beziehen sich auf unterschiedliche Erfassungsstände; Festtarifvergleich bis zum gemeinsamen Datenstand derzeit nicht berechenbar. ") + home.reasonDe,
    };
}
exports.reconcileHomeEnergy = reconcileHomeEnergy;
/** Dieselbe Wallboxmessung für Energie- und Mobilitätskarte verwenden. */
function reconcileMobilityEnergy(mobility, energy, options = {}) {
    const publicKwh = options.invoicedKwh ?? mobility.publicInvoicedKwh ?? 0;
    const publicEur = options.invoicedEur ?? mobility.publicInvoicedEur ?? 0;
    if ((!energy || energy.evChargedKwh === null) && publicKwh <= 0) {
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
            estimatedEvCostEur: null,
            estimatedSavingsVsIceEur: null,
            comparisonStatus: "unvollständig",
            reasonDe: "Gemessene Wallboxenergie für diesen Zeitraum noch nicht verfügbar. " + mobility.reasonDe,
        };
    }
    const measured = energy?.evChargedKwh ?? 0;
    const legacy = (mobility.homePvKwh ?? 0) + (mobility.homeGridKwh ?? 0);
    const sameEnergy = Math.abs(measured - legacy) <= 0.05;
    const onlyFast = energy?.evFastChargedKwh !== null && energy?.evFastChargedKwh !== undefined && Math.abs(measured - energy.evFastChargedKwh) <= 0.05;
    const sourcesComplete = onlyFast && energy?.evFastBatteryKwh !== null && energy?.evFastGridKwh !== null && energy?.evFastLocalKwh !== null;
    const homeGridKwh = sourcesComplete ? energy.evFastGridKwh : null;
    const homeBatteryKwh = sourcesComplete ? energy.evFastBatteryKwh : null;
    const homePvKwh = energy?.evPvKwh ?? null;
    const chargedWithInvoice = measured + publicKwh;
    const estimatedKm = mobility.evKwhPer100Km && mobility.evKwhPer100Km > 0
        ? Math.round((chargedWithInvoice / mobility.evKwhPer100Km) * 100_000) / 1000
        : null;
    const iceCost = (0, compute_1.iceCostForKm)({
        km: estimatedKm,
        lPer100Km: options.iceLPer100Km ?? null,
        fuelPriceEurPerL: mobility.fuelPriceEurPerL,
    }).costEur;
    const pairedHome = measured === 0 || (options.provisionalHomeCostEur != null &&
        options.provisionalChargedKwh != null && Math.abs(options.provisionalChargedKwh - measured) <= 0.05);
    const provisionalEvCostEur = pairedHome ? Math.round(Math.max(0, (options.provisionalHomeCostEur ?? 0) + publicEur - (options.billedRewardsEur ?? 0)) * 100) / 100 : null;
    const finalized = provisionalEvCostEur !== null && options.finalized === true &&
        (options.pendingInvoices ?? mobility.openPublicSessions ?? 0) === 0;
    return {
        ...mobility,
        homeChargedKwh: measured,
        homePvKwh,
        homeBatteryKwh,
        homeGridKwh,
        homeGridCostEur: null,
        homeGridCostNetEur: null,
        publicInvoicedKwh: publicKwh > 0 ? publicKwh : null,
        publicInvoicedEur: publicKwh > 0 ? publicEur : null,
        estimatedKm,
        estimatedEvCostEur: finalized ? null : provisionalEvCostEur,
        estimatedSavingsVsIceEur: finalized || provisionalEvCostEur === null || iceCost === null
            ? null : Math.round((iceCost - provisionalEvCostEur) * 100) / 100,
        evTotalCostEur: finalized ? provisionalEvCostEur : null,
        iceCostEur: iceCost,
        savingsVsIceEur: finalized && iceCost !== null ? Math.round((iceCost - provisionalEvCostEur) * 100) / 100 : null,
        comparisonStatus: provisionalEvCostEur === null || iceCost === null ? "unvollständig" : finalized ? "endgültig" : "vorläufig",
        reasonDe: (provisionalEvCostEur === null
            ? "Für mindestens einen gemessenen Ladeslot fehlen zeitgleiche PV-, Haus- oder Tibber-Preisdaten. "
            : finalized ? "Mit erfassten Abrechnungen abgeschlossen. "
                : "Vorläufige Rechnung aus zeitgleicher Wallboxenergie und Tibber-Viertelstundenpreis; direkte PV mit Einspeisevergütung bewertet. Batterieenergie ist im übrigen Anteil enthalten. Offene Schnelllade-Rechnungen und Grid Rewards werden erst nach Abrechnung ergänzt. ") +
            (!sameEnergy ? "Alte Sitzungszählung weicht von der Wallbox-Messung ab. " : "") + mobility.reasonDe,
    };
}
exports.reconcileMobilityEnergy = reconcileMobilityEnergy;

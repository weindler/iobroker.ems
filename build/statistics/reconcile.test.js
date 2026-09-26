"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const reconcile_1 = require("./reconcile");
const energy = (values) => ({
    evChargedKwh: 39.4,
    evPvKwh: 12.3,
    evFastChargedKwh: null,
    evFastBatteryKwh: null,
    evFastGridKwh: null,
    evFastLocalKwh: null,
    gridImportKwh: 51.1,
    ...values,
});
const mobility = {
    homePvKwh: 0,
    homeGridKwh: 55,
    homeGridCostEur: 11.5,
    homeGridCostNetEur: 10.5,
    publicInvoicedKwh: null,
    evTotalCostEur: 11.5,
    iceCostEur: 54.8,
    savingsVsIceEur: 43.3,
    evKwhPer100Km: 19.8,
    reasonDe: "Test.",
};
(0, node_test_1.describe)("gemeinsame Energiemengen der Statistik", () => {
    (0, node_test_1.it)("zeigt bei 39,4 kWh Wallbox nicht 55 kWh reinen Auto-Netzbezug und keine unbelegte Ersparnis", () => {
        const result = (0, reconcile_1.reconcileMobilityEnergy)(mobility, energy({}));
        strict_1.default.equal(result.homeChargedKwh, 39.4);
        strict_1.default.equal(result.homeGridKwh, null);
        strict_1.default.equal(result.homePvKwh, 12.3);
        strict_1.default.equal(result.savingsVsIceEur, null);
        strict_1.default.match(result.reasonDe, /Ladeslot/);
    });
    (0, node_test_1.it)("weist nur mit belegten Quellen Heim-Netz und Batterieanteil aus", () => {
        const result = (0, reconcile_1.reconcileMobilityEnergy)(mobility, energy({
            evFastChargedKwh: 39.4,
            evFastBatteryKwh: 0.1,
            evFastGridKwh: 27,
            evFastLocalKwh: 12.3,
        }));
        strict_1.default.equal(result.homeChargedKwh, 39.4);
        strict_1.default.equal(result.homeBatteryKwh, 0.1);
        strict_1.default.equal(result.homeGridKwh, 27);
        strict_1.default.equal(result.evTotalCostEur, null);
    });
    (0, node_test_1.it)("berechnet vorläufig aus zeitgleichen Ladepreisen und wird erst nach Abrechnung endgültig", () => {
        const result = (0, reconcile_1.reconcileMobilityEnergy)({ ...mobility, evKwhPer100Km: 20,
            fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
            evChargedKwh: 10, evPvKwh: 4, evFastChargedKwh: 10,
        }), { iceLPer100Km: 6, provisionalChargedKwh: 10, provisionalHomeCostEur: 2.17 });
        strict_1.default.equal(result.homeChargedKwh, 10);
        strict_1.default.equal(result.homeGridKwh, null);
        strict_1.default.equal(result.evTotalCostEur, null);
        strict_1.default.equal(result.estimatedEvCostEur, 2.17);
        strict_1.default.equal(result.iceCostEur, 5.4);
        strict_1.default.equal(result.estimatedSavingsVsIceEur, 3.23);
        strict_1.default.equal(result.comparisonStatus, "vorläufig");
        strict_1.default.match(result.reasonDe, /Viertelstundenpreis/);
        const settled = (0, reconcile_1.reconcileMobilityEnergy)({ ...mobility, evKwhPer100Km: 20,
            fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
            evChargedKwh: 10, evPvKwh: 4,
        }), { iceLPer100Km: 6, provisionalChargedKwh: 10, provisionalHomeCostEur: 2.17,
            invoicedKwh: 5, invoicedEur: 2, billedRewardsEur: 0.5, finalized: true });
        strict_1.default.equal(settled.evTotalCostEur, 3.67);
        strict_1.default.equal(settled.savingsVsIceEur, 4.43);
        strict_1.default.equal(settled.comparisonStatus, "endgültig");
        const withoutPrice = (0, reconcile_1.reconcileMobilityEnergy)({ ...mobility, evKwhPer100Km: 20,
            fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
            evChargedKwh: 10, evPvKwh: 4,
        }), { iceLPer100Km: 6 });
        strict_1.default.equal(withoutPrice.estimatedSavingsVsIceEur, null);
    });
    (0, node_test_1.it)("entfernt Tarifvorteil bei voneinander abweichendem Smart-Meter- und Tibber-Stand", () => {
        const home = { gridImportKwh: 51.7, dynamicCostEur: 20.04, fixedTariffCostEur: 24.04,
            savingsVsFixedEur: 4, reasonDe: "Test." };
        const result = (0, reconcile_1.reconcileHomeEnergy)(home, energy({}));
        strict_1.default.equal(result.gridImportKwh, 51.1);
        strict_1.default.equal(result.savingsVsFixedEur, null);
        strict_1.default.match(result.reasonDe, /unterschiedliche Erfassungsstände/);
    });
    (0, node_test_1.it)("trennt vorläufigen Monatsvergleich auf Tibber-Menge vom Smart Meter", () => {
        const home = { gridImportKwh: 62.7, dynamicCostEur: 24.45, fixedTariffCostEur: 29.40,
            savingsVsFixedEur: 4.95, reasonDe: "Test." };
        const result = (0, reconcile_1.reconcileHomeEnergy)(home, energy({ gridImportKwh: 62.1 }), { preserveTibberMonthlyComparison: true });
        strict_1.default.equal(result.gridImportKwh, 62.1);
        strict_1.default.equal(result.comparisonGridImportKwh, 62.7);
        strict_1.default.equal(result.savingsVsFixedEur, 4.95);
        strict_1.default.match(result.reasonDe, /Vorläufiger Preisvergleich/);
        const missing = (0, reconcile_1.reconcileHomeEnergy)({ ...home, dynamicCostEur: null }, energy({ gridImportKwh: 62.1 }), { preserveTibberMonthlyComparison: true });
        strict_1.default.equal(missing.savingsVsFixedEur, null);
    });
    (0, node_test_1.it)("berechnet Einspeisevergütung aus der Smart-Meter-Menge auch bei abweichender Historie", () => {
        const home = { gridImportKwh: 62.7, gridExportKwh: 370, feedInCreditEur: 34.41,
            dynamicCostEur: 24.45, fixedTariffCostEur: 29.40, savingsVsFixedEur: 4.95,
            reasonDe: "Test." };
        const result = (0, reconcile_1.reconcileHomeEnergy)(home, energy({ gridImportKwh: 62.1, gridExportKwh: 374.3 }), { preserveTibberMonthlyComparison: true, feedInCtPerKwh: 9.3 });
        strict_1.default.equal(result.feedInCreditEur, 34.81);
        strict_1.default.equal(result.gridExportKwh, 374.3);
    });
});

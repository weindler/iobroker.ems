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
        strict_1.default.match(result.reasonDe, /Tages-Telemetrie/);
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
    (0, node_test_1.it)("entfernt Tarifvorteil bei voneinander abweichendem Smart-Meter- und Tibber-Stand", () => {
        const home = { gridImportKwh: 51.7, dynamicCostEur: 20.04, fixedTariffCostEur: 24.04,
            savingsVsFixedEur: 4, reasonDe: "Test." };
        const result = (0, reconcile_1.reconcileHomeEnergy)(home, energy({}));
        strict_1.default.equal(result.gridImportKwh, 51.1);
        strict_1.default.equal(result.savingsVsFixedEur, null);
        strict_1.default.match(result.reasonDe, /unterschiedliche Erfassungsstände/);
    });
});

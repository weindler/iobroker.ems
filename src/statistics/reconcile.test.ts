import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileHomeEnergy, reconcileMobilityEnergy } from "./reconcile";
import type { EnergeticDayTotals, HouseCompareSummary, MobilityCompareSummary } from "./types";

const energy = (values: Partial<EnergeticDayTotals>) => ({
	evChargedKwh: 39.4,
	evPvKwh: 12.3,
	evFastChargedKwh: null,
	evFastBatteryKwh: null,
	evFastGridKwh: null,
	evFastLocalKwh: null,
	gridImportKwh: 51.1,
	...values,
}) as EnergeticDayTotals;
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
} as MobilityCompareSummary;

describe("gemeinsame Energiemengen der Statistik", () => {
	it("zeigt bei 39,4 kWh Wallbox nicht 55 kWh reinen Auto-Netzbezug und keine unbelegte Ersparnis", () => {
		const result = reconcileMobilityEnergy(mobility, energy({}));
		assert.equal(result.homeChargedKwh, 39.4);
		assert.equal(result.homeGridKwh, null);
		assert.equal(result.homePvKwh, 12.3);
		assert.equal(result.savingsVsIceEur, null);
		assert.match(result.reasonDe, /Ladeslot/);
	});
	it("weist nur mit belegten Quellen Heim-Netz und Batterieanteil aus", () => {
		const result = reconcileMobilityEnergy(mobility, energy({
			evFastChargedKwh: 39.4,
			evFastBatteryKwh: 0.1,
			evFastGridKwh: 27,
			evFastLocalKwh: 12.3,
		}));
		assert.equal(result.homeChargedKwh, 39.4);
		assert.equal(result.homeBatteryKwh, 0.1);
		assert.equal(result.homeGridKwh, 27);
		assert.equal(result.evTotalCostEur, null);
	});
	it("berechnet vorläufig aus zeitgleichen Ladepreisen und wird erst nach Abrechnung endgültig", () => {
		const result = reconcileMobilityEnergy({ ...mobility, evKwhPer100Km: 20,
			fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
			evChargedKwh: 10, evPvKwh: 4, evFastChargedKwh: 10,
		}), { iceLPer100Km: 6, provisionalChargedKwh: 10, provisionalHomeCostEur: 2.17 });
		assert.equal(result.homeChargedKwh, 10);
		assert.equal(result.homeGridKwh, null);
		assert.equal(result.evTotalCostEur, null);
		assert.equal(result.estimatedEvCostEur, 2.17);
		assert.equal(result.iceCostEur, 5.4);
		assert.equal(result.estimatedSavingsVsIceEur, 3.23);
		assert.equal(result.comparisonStatus, "vorläufig");
		assert.match(result.reasonDe, /Viertelstundenpreis/);
		const settled = reconcileMobilityEnergy({ ...mobility, evKwhPer100Km: 20,
			fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
			evChargedKwh: 10, evPvKwh: 4,
		}), { iceLPer100Km: 6, provisionalChargedKwh: 10, provisionalHomeCostEur: 2.17,
			invoicedKwh: 5, invoicedEur: 2, billedRewardsEur: 0.5, finalized: true });
		assert.equal(settled.evTotalCostEur, 3.67);
		assert.equal(settled.savingsVsIceEur, 4.43);
		assert.equal(settled.comparisonStatus, "endgültig");
		const withoutPrice = reconcileMobilityEnergy({ ...mobility, evKwhPer100Km: 20,
			fuelPriceEurPerL: 1.8, publicInvoicedKwh: null }, energy({
			evChargedKwh: 10, evPvKwh: 4,
		}), { iceLPer100Km: 6 });
		assert.equal(withoutPrice.estimatedSavingsVsIceEur, null);
	});
	it("entfernt Tarifvorteil bei voneinander abweichendem Smart-Meter- und Tibber-Stand", () => {
		const home = { gridImportKwh: 51.7, dynamicCostEur: 20.04, fixedTariffCostEur: 24.04,
			savingsVsFixedEur: 4, reasonDe: "Test." } as HouseCompareSummary;
		const result = reconcileHomeEnergy(home, energy({}));
		assert.equal(result.gridImportKwh, 51.1);
		assert.equal(result.savingsVsFixedEur, null);
		assert.match(result.reasonDe, /unterschiedliche Erfassungsstände/);
	});
	it("trennt vorläufigen Monatsvergleich auf Tibber-Menge vom Smart Meter", () => {
		const home = { gridImportKwh: 62.7, dynamicCostEur: 24.45, fixedTariffCostEur: 29.40,
			savingsVsFixedEur: 4.95, reasonDe: "Test." } as HouseCompareSummary;
		const result = reconcileHomeEnergy(home, energy({ gridImportKwh: 62.1 }),
			{ preserveTibberMonthlyComparison: true });
		assert.equal(result.gridImportKwh, 62.1);
		assert.equal(result.comparisonGridImportKwh, 62.7);
		assert.equal(result.savingsVsFixedEur, 4.95);
		assert.match(result.reasonDe, /Vorläufiger Preisvergleich/);
		const missing = reconcileHomeEnergy({ ...home, dynamicCostEur: null }, energy({ gridImportKwh: 62.1 }),
			{ preserveTibberMonthlyComparison: true });
		assert.equal(missing.savingsVsFixedEur, null);
	});
	it("berechnet Einspeisevergütung aus der Smart-Meter-Menge auch bei abweichender Historie", () => {
		const home = { gridImportKwh: 62.7, gridExportKwh: 370, feedInCreditEur: 34.41,
			dynamicCostEur: 24.45, fixedTariffCostEur: 29.40, savingsVsFixedEur: 4.95,
			reasonDe: "Test." } as HouseCompareSummary;
		const result = reconcileHomeEnergy(home, energy({ gridImportKwh: 62.1, gridExportKwh: 374.3 }),
			{ preserveTibberMonthlyComparison: true, feedInCtPerKwh: 9.3 });
		assert.equal(result.feedInCreditEur, 34.81);
		assert.equal(result.gridExportKwh, 374.3);
	});
});

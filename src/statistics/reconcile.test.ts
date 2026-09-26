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
		assert.match(result.reasonDe, /Tages-Telemetrie/);
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
	it("entfernt Tarifvorteil bei voneinander abweichendem Smart-Meter- und Tibber-Stand", () => {
		const home = { gridImportKwh: 51.7, dynamicCostEur: 20.04, fixedTariffCostEur: 24.04,
			savingsVsFixedEur: 4, reasonDe: "Test." } as HouseCompareSummary;
		const result = reconcileHomeEnergy(home, energy({}));
		assert.equal(result.gridImportKwh, 51.1);
		assert.equal(result.savingsVsFixedEur, null);
		assert.match(result.reasonDe, /unterschiedliche Erfassungsstände/);
	});
});

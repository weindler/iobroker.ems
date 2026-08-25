import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	energyCounterDeltaKwh,
	fixedTariffCostEur,
	iceCostForKm,
	integrateImportCostEur,
	resolveEvKwhPer100,
	savingsVsFixedEur,
	tibberDayCostEur,
} from "./compute.js";
import { statisticsConfigFromAdapter } from "./config.js";
import { applyPublicInvoice, openPublicChargeSession, parsePublicInvoiceSubmit } from "./public_charge.js";

describe("statistics compute", () => {
	it("fixed tariff cost matches Verivox-style energy + base share", () => {
		const cost = fixedTariffCostEur({
			gridImportKwh: 10,
			compareTariffCtPerKwh: 30,
			monthlyBaseEur: 10,
			monthFraction: 1 / 30,
		});
		assert.equal(cost, 3.33);
	});

	it("Tibber day cost adds monthly Grundpreis + Netzentgelt as daily share", () => {
		const cost = tibberDayCostEur({
			accumulatedCostEur: 0.1,
			monthlyBaseEur: 15.5,
			monthlyGridFeeEur: 15.5,
			monthFraction: 1 / 31,
		});
		// 0.1 + 15.5/31 + 15.5/31 ≈ 0.1 + 0.5 + 0.5 = 1.1
		assert.equal(cost, 1.1);
	});

	it("Tibber monthly fees come from Tarif-Tab natives; Verivox base stays in Statistik", () => {
		const cfg = statisticsConfigFromAdapter({
			statistics_compare_tariff_ct_per_kwh: 28,
			statistics_compare_tariff_monthly_base_eur: 12,
			tariff_monthly_base_eur: 5,
			tariff_grid_fee_monthly_eur: 8,
		});
		assert.equal(cfg.compareTariffMonthlyBaseEur, 12);
		assert.equal(cfg.tibberMonthlyBaseEur, 5);
		assert.equal(cfg.tibberMonthlyGridFeeEur, 8);
	});

	it("savings = fixed − (dynamic − rewards)", () => {
		assert.equal(savingsVsFixedEur(5, 3, 0.5), 2.5);
	});

	it("energy counter reset does not invent negative kWh", () => {
		const d = energyCounterDeltaKwh(100, 2);
		assert.equal(d.deltaKwh, 0);
		assert.equal(d.newBaseline, 2);
	});

	it("integrates import cost from power × Tibber", () => {
		const r = integrateImportCostEur({
			importPowerW: 2000,
			priceCtPerKwh: 30,
			dtSec: 3600,
		});
		assert.equal(r.kwh, 2);
		assert.equal(r.costEur, 0.6);
	});

	it("prefers Ford/HA consumption over admin fallback", () => {
		assert.deepEqual(resolveEvKwhPer100({ mapped: 18, fallback: 20 }), {
			value: 18,
			source: "ford_hass",
		});
		assert.deepEqual(resolveEvKwhPer100({ mapped: null, fallback: 20 }), {
			value: 20,
			source: "admin_fallback",
		});
	});

	it("ice cost from km × l/100 × fuel price", () => {
		const r = iceCostForKm({ km: 100, lPer100Km: 7, fuelPriceEurPerL: 1.8 });
		assert.equal(r.liters, 7);
		assert.equal(r.costEur, 12.6);
	});
});

describe("statistics public charge", () => {
	it("parses invoice submit and applies to latest pending", () => {
		const s = openPublicChargeSession({
			nowIso: "2026-08-20T10:00:00.000Z",
			estimatedKwh: 40,
			fuelPriceEurPerLSnapshot: 1.7,
		});
		const parsed = parsePublicInvoiceSubmit({ kwh: 38.2, eur: 22.5 });
		assert.ok(parsed);
		const out = applyPublicInvoice([s], parsed!, "2026-08-20T12:00:00.000Z");
		assert.match(out.ackDe, /Rechnung erfasst/);
		assert.equal(out.sessions[0]!.status, "invoiced");
		assert.equal(out.sessions[0]!.invoiceEur, 22.5);
	});

	it("rejects incomplete invoice", () => {
		const s = openPublicChargeSession({
			nowIso: "2026-08-20T10:00:00.000Z",
			estimatedKwh: 40,
			fuelPriceEurPerLSnapshot: null,
		});
		const out = applyPublicInvoice([s], { kwh: 40 }, "2026-08-20T12:00:00.000Z");
		assert.match(out.ackDe, /unvollständig/);
		assert.equal(out.sessions[0]!.status, "pending_invoice");
	});
});

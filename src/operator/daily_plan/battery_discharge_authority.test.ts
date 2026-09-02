import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBatteryDischargeAuthorization } from "./battery_discharge_authority.js";
import { evaluateBatteryOpportunityCost } from "./battery_opportunity_cost.js";

describe("battery discharge authority (Phase 1b/1d)", () => {
	const base = {
		priceNowCt: 36.7,
		minPriceCtPerKwh: 30,
		socPct: 60,
		requiredSocAtPvEndPct: 30,
		configuredMaxDischargeW: 5000,
	};

	it("allows discharge and publishes the configured budget when price and SOC are fine", () => {
		const r = resolveBatteryDischargeAuthorization(base);
		assert.equal(r.allowed, true);
		assert.equal(r.maxDischargeW, 5000);
		assert.equal(r.priceAllowed, true);
		assert.equal(r.socAllowed, true);
		assert.match(r.reasonDe, /SOC 60 % > dynamische Reserve 30 %/);
	});

	it("blocks below the minimum price (reuses evaluateGridBalanceMinPrice, not a second rule)", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, priceNowCt: 16.5 });
		assert.equal(r.allowed, false);
		assert.equal(r.maxDischargeW, 0);
		assert.equal(r.priceAllowed, false);
		assert.match(r.reasonDe, /unter Mindestpreis/);
	});

	it("blocks with unknown price", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, priceNowCt: null });
		assert.equal(r.allowed, false);
		assert.equal(r.maxDischargeW, 0);
		assert.equal(r.priceAllowed, false);
	});

	it("blocks at/below the dynamic reserve even when price allows", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, socPct: 30 });
		assert.equal(r.allowed, false);
		assert.equal(r.maxDischargeW, 0);
		assert.equal(r.priceAllowed, true);
		assert.equal(r.socAllowed, false);
		assert.match(r.reasonDe, /dynamische Reserve 30 %/);
	});

	it("blocks with unknown SOC", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, socPct: null });
		assert.equal(r.allowed, false);
		assert.equal(r.maxDischargeW, 0);
		assert.equal(r.priceAllowed, true);
		assert.equal(r.socAllowed, false);
		assert.match(r.reasonDe, /SOC unbekannt/);
	});

	it("Phase 1d: blocks conservatively (no hidden fixed fallback) when the dynamic reserve is not yet learnable", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, requiredSocAtPvEndPct: null });
		assert.equal(r.allowed, false);
		assert.equal(r.maxDischargeW, 0);
		assert.equal(r.priceAllowed, true);
		assert.equal(r.socAllowed, false);
		assert.match(r.reasonDe, /Nacht-Reserve noch nicht ausreichend gelernt/);
	});

	it("Phase 1d: unknown reserve is diagnosed distinctly from an unknown/insufficient SOC", () => {
		const rReserveUnknown = resolveBatteryDischargeAuthorization({
			...base,
			requiredSocAtPvEndPct: null,
		});
		const rSocTooLow = resolveBatteryDischargeAuthorization({ ...base, socPct: 30 });
		assert.notEqual(rReserveUnknown.reasonDe, rSocTooLow.reasonDe);
	});

	it("never returns a negative or non-integer budget", () => {
		const r = resolveBatteryDischargeAuthorization({ ...base, configuredMaxDischargeW: -10 });
		assert.equal(r.allowed, true);
		assert.equal(r.maxDischargeW, 0);
	});

	describe("Block B — Opportunity-Cost-Zusatzgate (additiv)", () => {
		it("ohne opportunityCostCtPerKwh: exakt bisheriges Verhalten (Fallback)", () => {
			const r = resolveBatteryDischargeAuthorization(base);
			assert.equal(r.allowed, true);
			assert.equal(r.opportunityAllowed, true);
		});

		it("Preis jetzt klar über Opportunity-Cost + Marge → weiterhin erlaubt", () => {
			const r = resolveBatteryDischargeAuthorization({ ...base, opportunityCostCtPerKwh: 20 });
			assert.equal(r.allowed, true);
			assert.equal(r.opportunityAllowed, true);
		});

		it("Preis jetzt nicht ausreichend über Opportunity-Cost → Netzausgleich zurückgestellt", () => {
			const r = resolveBatteryDischargeAuthorization({ ...base, opportunityCostCtPerKwh: 35 });
			assert.equal(r.allowed, false);
			assert.equal(r.opportunityAllowed, false);
			assert.equal(r.priceAllowed, true);
			assert.equal(r.socAllowed, true);
			assert.match(r.reasonDe, /Opportunity-Cost/);
		});

		it("Opportunity-Cost kann eine bereits gesperrte Entladung nicht freigeben (Preis-Gate bleibt vorrangig)", () => {
			const r = resolveBatteryDischargeAuthorization({ ...base, priceNowCt: 16.5, opportunityCostCtPerKwh: 0 });
			assert.equal(r.allowed, false);
			assert.equal(r.priceAllowed, false);
		});

		it("Opportunity-Cost kann Reserve-Sperre nicht aushebeln", () => {
			const r = resolveBatteryDischargeAuthorization({ ...base, socPct: 30, opportunityCostCtPerKwh: 0 });
			assert.equal(r.allowed, false);
			assert.equal(r.socAllowed, false);
		});

		it("eigene Margin-Konfiguration wird respektiert", () => {
			const r = resolveBatteryDischargeAuthorization({
				...base,
				opportunityCostCtPerKwh: 30,
				opportunityMarginCtPerKwh: 10,
			});
			// priceNowCt=36.7, opportunity=30, margin=10 → 36.7 < 40 → zurückgestellt
			assert.equal(r.allowed, false);
			assert.equal(r.opportunityAllowed, false);
		});
	});

	describe("PFLICHT-FIX 2 — Produktions-Regressionsfall (30.08.2026, planner_budget_zero trotz Preis/SOC/Reserve ok)", () => {
		it("hoher SOC (91 %), Preis über Schwelle, reichlich Headroom + kleiner später Bedarf → Netzausgleich bleibt zugelassen", () => {
			const opportunity = evaluateBatteryOpportunityCost({
				nowMs: Date.parse("2026-08-30T21:13:00.000Z"),
				priceSlots: [{ startMs: Date.parse("2026-08-31T18:00:00.000Z"), importCtPerKwh: 45 }],
				// SOC 91 % bei 10 kWh, Reserve ≈ 42 % (≈ 3.5 kWh × 1.2) → Headroom ≈ 4.9 kWh.
				headroomAboveReserveKwh: 4.9,
				pvRemainingTodayKwh: 0,
				plannedLaterDemandKwh: 2,
			});
			assert.ok(opportunity.opportunityCostCtPerKwh < 45, `opportunity=${opportunity.opportunityCostCtPerKwh}`);

			const r = resolveBatteryDischargeAuthorization({
				priceNowCt: 39.6,
				minPriceCtPerKwh: 30,
				socPct: 91,
				requiredSocAtPvEndPct: 42,
				configuredMaxDischargeW: 3000,
				opportunityCostCtPerKwh: opportunity.opportunityCostCtPerKwh,
			});
			assert.equal(r.allowed, true, r.reasonDe);
			assert.equal(r.opportunityAllowed, true);
			assert.equal(r.maxDischargeW, 3000);
		});
	});

	describe("Economic Grid Balance", () => {
		const eco = {
			usable: true,
			alpha: 0.7,
			beta: 1.1,
			cReplaceCtPerKwh: 22,
			marginCtPerKwh: 1.5,
		};

		it("Cold Start ohne Economics → 30-ct-Fallback", () => {
			const r = resolveBatteryDischargeAuthorization({ ...base, priceNowCt: 16.5 });
			assert.equal(r.allowed, false);
			assert.equal(r.economicsUsable, false);
			assert.match(r.reasonDe, /Mindestpreis/);
		});

		it("usable Economics erlaubt unter 30 ct wenn Netto positiv (kein 30-ct-Zusatzgate)", () => {
			const r = resolveBatteryDischargeAuthorization({
				...base,
				priceNowCt: 18,
				economics: { ...eco, alpha: 0.9, beta: 1.0, cReplaceCtPerKwh: 12 },
			});
			assert.equal(r.allowed, true, r.reasonDe);
			assert.equal(r.economicsUsable, true);
			assert.equal(r.economicsAllowed, true);
			assert.ok(r.netBenefitCtPerKwh != null && r.netBenefitCtPerKwh > 1.5);
		});

		it("usable Economics blockt bei negativem Netto trotz Preis > 30 ct", () => {
			const r = resolveBatteryDischargeAuthorization({
				...base,
				priceNowCt: 36,
				economics: { ...eco, alpha: 0.4, beta: 1.2, cReplaceCtPerKwh: 40 },
			});
			assert.equal(r.allowed, false);
			assert.equal(r.economicsUsable, true);
			assert.equal(r.economicsAllowed, false);
		});

		it("Economics öffnet Reserve-Sperre nicht", () => {
			const r = resolveBatteryDischargeAuthorization({
				...base,
				socPct: 20,
				priceNowCt: 50,
				economics: eco,
			});
			assert.equal(r.allowed, false);
			assert.equal(r.socAllowed, false);
		});

		it("Economics nicht mehr belastbar → automatisch 30-ct-Fallback", () => {
			const r = resolveBatteryDischargeAuthorization({
				...base,
				priceNowCt: 16.5,
				economics: { usable: false, alpha: 0.7, beta: 1.1, cReplaceCtPerKwh: 22 },
			});
			assert.equal(r.allowed, false);
			assert.equal(r.economicsUsable, false);
			assert.match(r.reasonDe, /Mindestpreis/);
		});
	});

	describe("PFLICHT-FIX 2 leftover — Hold/Reserve/Safety", () => {
		it("Netzausgleich bleibt trotz reichlichem Headroom gesperrt, wenn Hold/Reserve/Safety greifen", () => {
			// SOC unterhalb der Reserve — Opportunity-Discount darf das nie aushebeln.
			const rReserve = resolveBatteryDischargeAuthorization({
				priceNowCt: 39.6,
				minPriceCtPerKwh: 30,
				socPct: 35,
				requiredSocAtPvEndPct: 42,
				configuredMaxDischargeW: 3000,
				opportunityCostCtPerKwh: 5,
			});
			assert.equal(rReserve.allowed, false);
			assert.equal(rReserve.socAllowed, false);

			// Preis unter Mindestpreis — bleibt vorrangig vor jedem Opportunity-Abschlag.
			const rPrice = resolveBatteryDischargeAuthorization({
				priceNowCt: 20,
				minPriceCtPerKwh: 30,
				socPct: 91,
				requiredSocAtPvEndPct: 42,
				configuredMaxDischargeW: 3000,
				opportunityCostCtPerKwh: 5,
			});
			assert.equal(rPrice.allowed, false);
			assert.equal(rPrice.priceAllowed, false);
		});
	});
});

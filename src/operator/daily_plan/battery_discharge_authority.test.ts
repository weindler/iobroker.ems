import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveBatteryDischargeAuthorization } from "./battery_discharge_authority.js";

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
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etaFromBalance, type BalanceDay } from "./eta_balance";

function day(dateKey: string, c: number, d: number, s0: number, s1: number, cov = 1): BalanceDay {
	return { dateKey, chargedKwh: c, dischargedKwh: d, socFirstPct: s0, socLastPct: s1, socCoverage: cov };
}

describe("etaFromBalance", () => {
	it("berechnet η aus Bilanz über mehrere Tage (Speicherinhalt berücksichtigt)", () => {
		/* Kapazität 10 kWh, Start 20 %, Ende 40 % → +2 kWh gespeichert. Geladen 22, entladen 18 → 18/(22-2)=0,90 */
		const days = [day("2026-11-10", 6, 4, 20, 30), day("2026-11-11", 5, 5, 30, 28), day("2026-11-12", 6, 4, 28, 35), day("2026-11-13", 5, 5, 35, 40)];
		const r = etaFromBalance(days, 10);
		assert.equal(r.eta, 0.9);
		assert.equal(r.days, 4);
	});
	it("braucht lückenlose Tage und genug Energie", () => {
		const gap = [day("2026-11-08", 6, 5, 20, 20), day("2026-11-10", 6, 5, 20, 20), day("2026-11-11", 6, 5, 20, 20), day("2026-11-12", 6, 5, 20, 20)];
		assert.equal(etaFromBalance(gap, 10).eta, null);
		const small = [1, 2, 3, 4].map((i) => day(`2026-11-0${i}`, 1, 1, 20, 20));
		assert.equal(etaFromBalance(small, 10).eta, null);
		assert.equal(etaFromBalance(small, null).eta, null);
	});
	it("verwirft unplausible Ergebnisse und Tage mit Datenlücken", () => {
		const bad = ["10", "11", "12", "13"].map((n) => day(`2026-11-${n}`, 6, 2, 20, 20));
		assert.equal(etaFromBalance(bad, 10).eta, null);
		const holes = [day("2026-11-10", 6, 5, 20, 20), day("2026-11-11", 6, 5, 20, 20, 0.2), day("2026-11-12", 6, 5, 20, 20), day("2026-11-13", 6, 5, 20, 20)];
		assert.equal(etaFromBalance(holes, 10).days, 2);
	});
});

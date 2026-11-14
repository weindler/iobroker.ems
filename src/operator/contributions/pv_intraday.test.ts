import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	applyIntradayFactor,
	computeIntradayFactor,
	expectedEnergySoFarKwh,
	recentActualFromHistory,
} from "./pv_intraday";

function slots(): Array<{ startIso: string; endIso: string; pvPowerW: number }> {
	const out = [];
	const base = Date.parse("2026-11-14T08:00:00.000Z");
	for (let i = 0; i < 16; i++) {
		out.push({
			startIso: new Date(base + i * 900_000).toISOString(),
			endIso: new Date(base + (i + 1) * 900_000).toISOString(),
			pvPowerW: 2000,
		});
	}
	return out;
}

describe("pv intraday", () => {
	const now = Date.parse("2026-11-14T10:00:00.000Z"); // 2 h = 4 kWh erwartet

	it("sums expected energy, partial slot proportional", () => {
		assert.equal(expectedEnergySoFarKwh(slots(), now), 4);
		assert.equal(expectedEnergySoFarKwh(slots(), Date.parse("2026-11-14T08:07:30.000Z")), 0.25);
	});

	it("scales down when actual is far below expected", () => {
		const r = computeIntradayFactor(slots(), 2, now);
		assert.equal(r.active, true);
		assert.equal(r.factor, 0.5);
	});

	it("caps upward factor", () => {
		assert.equal(computeIntradayFactor(slots(), 40, now).factor, 1.25);
	});

	it("no correction with too little evidence or invalid actual", () => {
		assert.equal(computeIntradayFactor(slots(), 0, Date.parse("2026-11-14T08:15:00.000Z")).factor, 1);
		assert.equal(computeIntradayFactor(slots(), null, now).factor, 1);
	});

	it("within tolerance stays 1", () => {
		assert.equal(computeIntradayFactor(slots(), 3.9, now).active, false);
	});

	it("applies factor only to future slots", () => {
		const out = applyIntradayFactor(slots(), 0.5, now);
		assert.equal(out[0].pvPowerW, 2000);
		assert.equal(out[15].pvPowerW, 1000);
	});

	it("letzte Stunde senkt den Faktor schneller als die Tagessumme", () => {
		// Tagessumme passt (4 kWh), letzte Stunde nur 1 von erwarteten 2 kWh
		const withoutRecent = computeIntradayFactor(slots(), 4, now);
		assert.equal(withoutRecent.active, false);
		const r = computeIntradayFactor(slots(), 4, now, { deltaKwh: 1, windowMs: 3_600_000 });
		assert.equal(r.active, true);
		assert.equal(r.factor, 0.75);
	});

	it("Toleranz 8 %: kleine Abweichung bleibt ohne Korrektur", () => {
		assert.equal(computeIntradayFactor(slots(), 3.8, now).active, false);
		assert.equal(computeIntradayFactor(slots(), 3.5, now).active, true);
	});

	it("recentActualFromHistory nimmt den Stand ~60 min zurück, sonst null", () => {
		const h = [
			{ ts: now - 120 * 60_000, kwh: 0.5 },
			{ ts: now - 62 * 60_000, kwh: 1.5 },
			{ ts: now - 10 * 60_000, kwh: 3.5 },
		];
		const r = recentActualFromHistory(h, now, 4);
		assert.equal(r?.deltaKwh, 2.5);
		assert.equal(recentActualFromHistory([{ ts: now - 10 * 60_000, kwh: 3.5 }], now, 4), null);
		assert.equal(recentActualFromHistory(h, now, 1), null);
	});
});

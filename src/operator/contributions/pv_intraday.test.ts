import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyIntradayFactor, computeIntradayFactor, expectedEnergySoFarKwh } from "./pv_intraday";

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
});

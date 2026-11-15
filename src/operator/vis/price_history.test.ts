import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergePriceHistory, emptyPriceHistory, PRICE_HISTORY_KEEP_MS } from "./price_history";

describe("price_history", () => {
	const now = Date.UTC(2026, 10, 15, 10, 0, 0);
	it("mischt neue Preise ein und meldet changed", () => {
		const r = mergePriceHistory(emptyPriceHistory(), now, [[now - 3_600_000, 27.5]]);
		assert.equal(r.changed, true);
		assert.equal(r.history.a[String(now - 3_600_000)], 27.5);
	});
	it("gleiche Werte ändern nichts", () => {
		const r1 = mergePriceHistory(emptyPriceHistory(), now, [[now - 900_000, 30]]);
		const r2 = mergePriceHistory(r1.history, now, [[now - 900_000, 30]]);
		assert.equal(r2.changed, false);
	});
	it("verwirft Älteres als 72 h und ignoriert ungültige Werte", () => {
		const old = now - PRICE_HISTORY_KEEP_MS - 1000;
		const r = mergePriceHistory({ version: 1, a: { [String(old)]: 20 } }, now, [[NaN, 1], [now, Number.NaN]]);
		assert.equal(r.changed, true);
		assert.deepEqual(r.history.a, {});
	});
});

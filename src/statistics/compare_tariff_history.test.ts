import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseCompareTariffHistory, recordCompareTariff, tariffForRange } from "./compare_tariff_history";

describe("compare_tariff_history", () => {
	it("seedet beim ersten Mal und hängt nur bei Änderung an", () => {
		let r = recordCompareTariff([], "2026-11-15", 26.44, 14.8);
		assert.equal(r.history.length, 1);
		assert.equal(r.history[0]!.from, "0000-00-00");
		r = recordCompareTariff(r.history, "2026-11-16", 26.44, 14.8);
		assert.equal(r.changed, false);
		r = recordCompareTariff(r.history, "2026-11-16", 30.56, 14.8);
		assert.equal(r.history.length, 2);
		r = recordCompareTariff(r.history, "2026-11-16", 31, 14.8);
		assert.equal(r.history.length, 2);
		assert.equal(r.history[1]!.ctPerKwh, 31);
	});
	it("vergangene Tage behalten den alten Preis", () => {
		const h = recordCompareTariff(recordCompareTariff([], "2026-11-01", 26.44, 14.8).history, "2026-11-16", 30.56, 14.8).history;
		const fb = { ctPerKwh: 30.56, monthlyBaseEur: 14.8 };
		assert.equal(tariffForRange(h, "2026-10-01", "2026-10-31", fb).ctPerKwh, 26.44);
		assert.equal(tariffForRange(h, "2026-11-16", "2026-11-30", fb).ctPerKwh, 30.56);
		const mix = tariffForRange(h, "2026-11-01", "2026-11-30", fb).ctPerKwh!;
		assert.ok(mix > 26.44 && mix < 30.56);
	});
	it("parst robust", () => {
		assert.deepEqual(parseCompareTariffHistory("kaputt"), []);
		assert.equal(parseCompareTariffHistory('[{"from":"2026-01-01","ctPerKwh":30,"monthlyBaseEur":1}]').length, 1);
	});
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	EMPTY_COMPARE_TARIFF_AUTO,
	fetchCompareTariff,
	isAutoValueFresh,
	parseVerivoxAveragePrice,
	shouldRefetch,
	workPriceFromBrutto,
} from "./compare_tariff_auto";

const HTML = "<p>Die Strompreise für Neukunden liegen aktuell bei <b>rund 35 Cent pro Kilowattstunde</b> (kWh) brutto.</p>";

describe("compare_tariff_auto", () => {
	it("liest den Durchschnittspreis", () => {
		assert.equal(parseVerivoxAveragePrice(HTML), 35);
		assert.equal(parseVerivoxAveragePrice("rund 31,5 Cent pro Kilowattstunde"), 31.5);
		assert.equal(parseVerivoxAveragePrice("rund 3 Cent pro Kilowattstunde"), null);
		assert.equal(parseVerivoxAveragePrice("nichts"), null);
	});
	it("rechnet den Grundpreis heraus", () => {
		assert.equal(workPriceFromBrutto(35, 14.8), 30.56);
		assert.equal(workPriceFromBrutto(35, 0), 35);
	});
	it("holt höchstens einmal pro Woche, Wiederholung nach Fehler frühestens nach 6 h", () => {
		const now = Date.parse("2026-11-15T10:00:00Z");
		assert.equal(shouldRefetch(EMPTY_COMPARE_TARIFF_AUTO, now), true);
		const ok = { ...EMPTY_COMPARE_TARIFF_AUTO, fetchedAt: "2026-11-12T10:00:00Z", attemptedAt: "2026-11-12T10:00:00Z", workCtPerKwh: 30, bruttoCtPerKwh: 35, status: "ok" as const };
		assert.equal(shouldRefetch(ok, now), false);
		assert.equal(shouldRefetch(ok, now + 5 * 24 * 3600 * 1000), true);
		assert.equal(shouldRefetch({ ...ok, attemptedAt: "2026-11-15T08:00:00Z", fetchedAt: "2026-11-01T00:00:00Z" }, now), false);
		assert.equal(isAutoValueFresh(ok, now), true);
		assert.equal(isAutoValueFresh(ok, now + 30 * 24 * 3600 * 1000), false);
	});
	it("behält bei Fehler den letzten guten Wert", async () => {
		const now = Date.parse("2026-11-15T10:00:00Z");
		const good = await fetchCompareTariff(EMPTY_COMPARE_TARIFF_AUTO, 14.8, now, async () => HTML);
		assert.equal(good.status, "ok");
		assert.equal(good.workCtPerKwh, 30.56);
		const bad = await fetchCompareTariff(good, 14.8, now + 1000, async () => {
			throw new Error("HTTP 503");
		});
		assert.equal(bad.workCtPerKwh, 30.56);
		assert.equal(bad.status, "ok");
		assert.equal(bad.errorDe, "HTTP 503");
		const none = await fetchCompareTariff(EMPTY_COMPARE_TARIFF_AUTO, 0, now, async () => "leer");
		assert.equal(none.status, "error");
	});
});

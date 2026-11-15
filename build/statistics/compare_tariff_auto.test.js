"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const compare_tariff_auto_1 = require("./compare_tariff_auto");
const HTML = "<p>Die Strompreise für Neukunden liegen aktuell bei <b>rund 35 Cent pro Kilowattstunde</b> (kWh) brutto.</p>";
(0, node_test_1.describe)("compare_tariff_auto", () => {
    (0, node_test_1.it)("liest den Durchschnittspreis", () => {
        node_assert_1.strict.equal((0, compare_tariff_auto_1.parseVerivoxAveragePrice)(HTML), 35);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.parseVerivoxAveragePrice)("rund 31,5 Cent pro Kilowattstunde"), 31.5);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.parseVerivoxAveragePrice)("rund 3 Cent pro Kilowattstunde"), null);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.parseVerivoxAveragePrice)("nichts"), null);
    });
    (0, node_test_1.it)("rechnet den Grundpreis heraus", () => {
        node_assert_1.strict.equal((0, compare_tariff_auto_1.workPriceFromBrutto)(35, 14.8), 30.56);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.workPriceFromBrutto)(35, 0), 35);
    });
    (0, node_test_1.it)("holt höchstens einmal pro Woche, Wiederholung nach Fehler frühestens nach 6 h", () => {
        const now = Date.parse("2026-11-15T10:00:00Z");
        node_assert_1.strict.equal((0, compare_tariff_auto_1.shouldRefetch)(compare_tariff_auto_1.EMPTY_COMPARE_TARIFF_AUTO, now), true);
        const ok = { ...compare_tariff_auto_1.EMPTY_COMPARE_TARIFF_AUTO, fetchedAt: "2026-11-12T10:00:00Z", attemptedAt: "2026-11-12T10:00:00Z", workCtPerKwh: 30, bruttoCtPerKwh: 35, status: "ok" };
        node_assert_1.strict.equal((0, compare_tariff_auto_1.shouldRefetch)(ok, now), false);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.shouldRefetch)(ok, now + 5 * 24 * 3600 * 1000), true);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.shouldRefetch)({ ...ok, attemptedAt: "2026-11-15T08:00:00Z", fetchedAt: "2026-11-01T00:00:00Z" }, now), false);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.isAutoValueFresh)(ok, now), true);
        node_assert_1.strict.equal((0, compare_tariff_auto_1.isAutoValueFresh)(ok, now + 30 * 24 * 3600 * 1000), false);
    });
    (0, node_test_1.it)("behält bei Fehler den letzten guten Wert", async () => {
        const now = Date.parse("2026-11-15T10:00:00Z");
        const good = await (0, compare_tariff_auto_1.fetchCompareTariff)(compare_tariff_auto_1.EMPTY_COMPARE_TARIFF_AUTO, 14.8, now, async () => HTML);
        node_assert_1.strict.equal(good.status, "ok");
        node_assert_1.strict.equal(good.workCtPerKwh, 30.56);
        const bad = await (0, compare_tariff_auto_1.fetchCompareTariff)(good, 14.8, now + 1000, async () => {
            throw new Error("HTTP 503");
        });
        node_assert_1.strict.equal(bad.workCtPerKwh, 30.56);
        node_assert_1.strict.equal(bad.status, "ok");
        node_assert_1.strict.equal(bad.errorDe, "HTTP 503");
        const none = await (0, compare_tariff_auto_1.fetchCompareTariff)(compare_tariff_auto_1.EMPTY_COMPARE_TARIFF_AUTO, 0, now, async () => "leer");
        node_assert_1.strict.equal(none.status, "error");
    });
});

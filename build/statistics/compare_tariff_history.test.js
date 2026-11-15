"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const compare_tariff_history_1 = require("./compare_tariff_history");
(0, node_test_1.describe)("compare_tariff_history", () => {
    (0, node_test_1.it)("seedet beim ersten Mal und hängt nur bei Änderung an", () => {
        let r = (0, compare_tariff_history_1.recordCompareTariff)([], "2026-11-15", 26.44, 14.8);
        node_assert_1.strict.equal(r.history.length, 1);
        node_assert_1.strict.equal(r.history[0].from, "0000-00-00");
        r = (0, compare_tariff_history_1.recordCompareTariff)(r.history, "2026-11-16", 26.44, 14.8);
        node_assert_1.strict.equal(r.changed, false);
        r = (0, compare_tariff_history_1.recordCompareTariff)(r.history, "2026-11-16", 30.56, 14.8);
        node_assert_1.strict.equal(r.history.length, 2);
        r = (0, compare_tariff_history_1.recordCompareTariff)(r.history, "2026-11-16", 31, 14.8);
        node_assert_1.strict.equal(r.history.length, 2);
        node_assert_1.strict.equal(r.history[1].ctPerKwh, 31);
    });
    (0, node_test_1.it)("vergangene Tage behalten den alten Preis", () => {
        const h = (0, compare_tariff_history_1.recordCompareTariff)((0, compare_tariff_history_1.recordCompareTariff)([], "2026-11-01", 26.44, 14.8).history, "2026-11-16", 30.56, 14.8).history;
        const fb = { ctPerKwh: 30.56, monthlyBaseEur: 14.8 };
        node_assert_1.strict.equal((0, compare_tariff_history_1.tariffForRange)(h, "2026-10-01", "2026-10-31", fb).ctPerKwh, 26.44);
        node_assert_1.strict.equal((0, compare_tariff_history_1.tariffForRange)(h, "2026-11-16", "2026-11-30", fb).ctPerKwh, 30.56);
        const mix = (0, compare_tariff_history_1.tariffForRange)(h, "2026-11-01", "2026-11-30", fb).ctPerKwh;
        node_assert_1.strict.ok(mix > 26.44 && mix < 30.56);
    });
    (0, node_test_1.it)("parst robust", () => {
        node_assert_1.strict.deepEqual((0, compare_tariff_history_1.parseCompareTariffHistory)("kaputt"), []);
        node_assert_1.strict.equal((0, compare_tariff_history_1.parseCompareTariffHistory)('[{"from":"2026-01-01","ctPerKwh":30,"monthlyBaseEur":1}]').length, 1);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const math_1 = require("./math");
(0, node_test_1.describe)("pv_bias math", () => {
    (0, node_test_1.it)("ignores missing forecast (null pair)", () => {
        const b = (0, math_1.dayBiasPct)(24, 0);
        strict_1.default.equal(b, null);
    });
    (0, node_test_1.it)("ignores forecast = 0 (no division by zero)", () => {
        const b = (0, math_1.dayBiasPct)(10, 0);
        strict_1.default.equal(b, null);
        const pairs = [{ dayOffset: 0, actualKwh: 10, forecastKwh: 0 }];
        const m = (0, math_1.meanBiasPct)(pairs);
        strict_1.default.equal(m.sampleDays, 0);
        strict_1.default.equal(m.biasPct, null);
    });
    (0, node_test_1.it)("negative bias when forecast too high", () => {
        const b = (0, math_1.dayBiasPct)(24, 30);
        strict_1.default.ok(b !== null && b < 0);
        strict_1.default.equal(Math.round(b), -20);
    });
    (0, node_test_1.it)("positive bias when forecast too low", () => {
        const b = (0, math_1.dayBiasPct)(36, 30);
        strict_1.default.ok(b !== null && b > 0);
        strict_1.default.equal(Math.round(b), 20);
    });
    (0, node_test_1.it)("skips days with missing actual in window", () => {
        const pairs = [
            { dayOffset: 1, actualKwh: 20, forecastKwh: 25 },
            { dayOffset: 2, actualKwh: 22, forecastKwh: 20 },
        ];
        const m = (0, math_1.meanBiasPct)(pairs);
        strict_1.default.equal(m.sampleDays, 2);
    });
    (0, node_test_1.it)("low confidence with little history", () => {
        const pairs = [{ dayOffset: 1, actualKwh: 10, forecastKwh: 12 }];
        const r = (0, math_1.computePvBias)(pairs, 30, 35);
        strict_1.default.ok(r.confidencePct < 40);
        strict_1.default.equal(r.status, "insufficient_data");
    });
    (0, node_test_1.it)("corrects forecast with bias", () => {
        const corrected = (0, math_1.correctForecastKwh)(30, -20);
        strict_1.default.equal(corrected, 24);
    });
    (0, node_test_1.it)("combines 14-day trend and up-to-90-day energy basis", () => {
        const pairs = [];
        for (let i = 1; i <= 7; i++) {
            pairs.push({ dayOffset: i, actualKwh: 24, forecastKwh: 30 });
        }
        for (let i = 8; i < 30; i++) {
            pairs.push({ dayOffset: i, actualKwh: 30, forecastKwh: 30 });
        }
        const r = (0, math_1.computePvBias)(pairs, null, 100);
        strict_1.default.equal(r.bias7dPct !== null && Math.round(r.bias7dPct), -20);
        strict_1.default.equal(r.bias14dPct !== null && Math.round(r.bias14dPct), -10);
        strict_1.default.ok(r.bias90dPct !== null && r.bias90dPct > -5 && r.bias90dPct < -4);
        strict_1.default.ok(r.modelBiasPct !== null && r.modelBiasPct > -7 && r.modelBiasPct < -6);
        strict_1.default.ok(r.correctedTomorrowKwh !== null && r.correctedTomorrowKwh > 92 && r.correctedTomorrowKwh < 95);
    });
    (0, node_test_1.it)("corrected today uses 7d bias, not poisoned intraday today pair", () => {
        const pairs = [
            { dayOffset: 0, actualKwh: 44, forecastKwh: 13.2 },
            { dayOffset: 1, actualKwh: 24, forecastKwh: 30 },
            { dayOffset: 2, actualKwh: 24, forecastKwh: 30 },
            { dayOffset: 3, actualKwh: 24, forecastKwh: 30 },
        ];
        const r = (0, math_1.computePvBias)(pairs, 13.2, null);
        strict_1.default.equal(r.biasTodayPct !== null && Math.round(r.biasTodayPct), 233);
        strict_1.default.equal(r.bias7dPct !== null && Math.round(r.bias7dPct), -20);
        strict_1.default.equal(r.correctedTodayKwh, 13.2);
    });
    (0, node_test_1.it)("excludes incomplete today from 7d sample", () => {
        const pairs = [{ dayOffset: 0, actualKwh: 5, forecastKwh: 20 }];
        const r = (0, math_1.computePvBias)(pairs, 20, 25);
        strict_1.default.equal(r.sampleDays7d, 0);
        strict_1.default.equal(r.bias7dPct, null);
    });
    (0, node_test_1.it)("confidence scales with sample days", () => {
        strict_1.default.equal((0, math_1.confidencePct)(0, 0, null), 0);
        strict_1.default.ok((0, math_1.confidencePct)(2, 2, 40) < (0, math_1.confidencePct)(20, 7, 10));
    });
    (0, node_test_1.it)("uses energy sums so the September production outlier cannot dominate", () => {
        const pairs = [
            [28.384, 12.55], [23.96, 29.624], [26.564, 33.631], [10.064, 15.83],
            [27.294, 21.958], [32.404, 21.958], [23.173, 35.3],
        ].map(([actualKwh, forecastKwh], idx) => ({ dayOffset: idx + 1, actualKwh: actualKwh, forecastKwh: forecastKwh }));
        const weighted = (0, math_1.energyBiasPct)(pairs);
        strict_1.default.ok(weighted.biasPct !== null && Math.abs(weighted.biasPct - 0.581) < 0.01);
        const r = (0, math_1.computePvBias)(pairs, 33.846, 24.77);
        strict_1.default.ok(r.modelBiasPct !== null && Math.abs(r.modelBiasPct - 0.581) < 0.01);
        strict_1.default.ok(r.appliedBiasPct !== null && Math.abs(r.appliedBiasPct) < Math.abs(r.modelBiasPct));
        strict_1.default.ok(r.confidencePct <= 50);
    });
    (0, node_test_1.it)("applies a fully confirmed persistent bias without a fixed cap", () => {
        const pairs = Array.from({ length: 30 }, (_, idx) => ({ dayOffset: idx + 1, actualKwh: 15, forecastKwh: 30 }));
        const r = (0, math_1.computePvBias)(pairs, 30, 40);
        strict_1.default.equal(r.confidencePct, 100);
        strict_1.default.equal(r.modelBiasPct, -50);
        strict_1.default.equal(r.appliedBiasPct, -50);
        strict_1.default.equal(r.correctedTomorrowKwh, 20);
    });
});

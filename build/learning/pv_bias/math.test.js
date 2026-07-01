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
    (0, node_test_1.it)("tomorrow correction prefers 7d bias over 30d", () => {
        const pairs = [];
        for (let i = 1; i <= 7; i++) {
            pairs.push({ dayOffset: i, actualKwh: 24, forecastKwh: 30 });
        }
        for (let i = 8; i < 30; i++) {
            pairs.push({ dayOffset: i, actualKwh: 30, forecastKwh: 30 });
        }
        const r = (0, math_1.computePvBias)(pairs, null, 100);
        strict_1.default.equal(r.bias7dPct !== null && Math.round(r.bias7dPct), -20);
        strict_1.default.equal(r.correctedTomorrowKwh, 80);
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
        strict_1.default.equal(r.correctedTodayKwh, 10.56);
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
});

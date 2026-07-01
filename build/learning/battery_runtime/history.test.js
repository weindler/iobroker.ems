"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const history_1 = require("./history");
const math_1 = require("./math");
const constants_1 = require("./constants");
(0, node_test_1.describe)("battery runtime power history", () => {
    (0, node_test_1.it)("auto-detects Sonnen-like sign convention", () => {
        const rows = [
            { val: 250 },
            { val: 260 },
            { val: 240 },
            { val: -1200 },
            { val: -800 },
        ];
        const r = (0, history_1.resolveEffectivePowerInvert)(false, rows);
        strict_1.default.equal(r.invert, true);
        strict_1.default.equal(r.autoDetected, true);
    });
    (0, node_test_1.it)("keeps hourly charge peak when hour ends with standby discharge", () => {
        const base = Date.parse("2026-06-30T12:00:00Z");
        const rows = [
            { ts: base + 5 * 60_000, val: -3000 },
            { ts: base + 55 * 60_000, val: 80 },
        ];
        const legacyLastWins = (0, history_1.aggregatePowerPointsByHour)(rows, true);
        const stats = (0, math_1.computePowerStats)(legacyLastWins.points);
        strict_1.default.equal(stats.maxChargePowerW, 3000);
        strict_1.default.equal(stats.avgChargePowerW, 3000);
        strict_1.default.equal(legacyLastWins.meta.rawChargeSamples, 1);
        strict_1.default.equal(legacyLastWins.meta.rawDischargeSamples, 1);
        strict_1.default.equal(legacyLastWins.meta.hourlyChargePoints, 1);
        strict_1.default.equal(legacyLastWins.meta.hourlyDischargePoints, 1);
    });
    (0, node_test_1.it)("last-value hourly dedup would drop charge without max-per-hour aggregation", () => {
        const base = Date.parse("2026-06-30T12:00:00Z");
        const bucket = Math.floor(base / constants_1.MS_PER_HOUR);
        let last = null;
        for (const row of [
            { ts: base + 5 * 60_000, val: -3000 },
            { ts: base + 55 * 60_000, val: 80 },
        ]) {
            const w = (0, history_1.normalizeBatteryPowerW)(row.val, true);
            if (w !== null)
                last = w;
        }
        strict_1.default.equal(last, -80);
        const stats = (0, math_1.computePowerStats)(last !== null ? [{ ts: base, powerW: last }] : []);
        strict_1.default.equal(stats.maxChargePowerW, null);
        strict_1.default.equal(stats.maxDischargePowerW, 80);
        strict_1.default.notEqual(bucket, 0);
    });
});

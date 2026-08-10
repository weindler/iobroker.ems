"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const thermal_cooling_rate_1 = require("./thermal_cooling_rate");
(0, node_test_1.describe)("effectiveCoolingRateCPerH", () => {
    (0, node_test_1.it)("prefers cycle average when present", () => {
        const r = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.08,
            coolingAsymptoteC: 40,
            bufferTempC: 54,
            minTempC: 44,
            estimatedEmptyAtMs: null,
            nowMs: Date.parse("2026-08-10T08:00:00.000Z"),
        });
        strict_1.default.equal(r, 0.9);
    });
    (0, node_test_1.it)("derives Newton instantaneous rate when avg missing", () => {
        const r = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.1,
            coolingAsymptoteC: 40,
            bufferTempC: 50,
            minTempC: 44,
            estimatedEmptyAtMs: null,
            nowMs: Date.parse("2026-08-10T08:00:00.000Z"),
        });
        strict_1.default.equal(r, 1); // 0.1 * (50-40)
    });
    (0, node_test_1.it)("falls back to emptyAt linearization", () => {
        const now = Date.parse("2026-08-10T08:00:00.000Z");
        const r = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            bufferTempC: 54,
            minTempC: 44,
            estimatedEmptyAtMs: now + 10 * 3600_000,
            nowMs: now,
        });
        strict_1.default.ok(r != null && Math.abs(r - 1) < 0.01, `got ${r}`);
    });
    (0, node_test_1.it)("returns null when no physics available", () => {
        const r = (0, thermal_cooling_rate_1.effectiveCoolingRateCPerH)({
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            bufferTempC: 54,
            minTempC: null,
            estimatedEmptyAtMs: null,
            nowMs: Date.now(),
        });
        strict_1.default.equal(r, null);
    });
});

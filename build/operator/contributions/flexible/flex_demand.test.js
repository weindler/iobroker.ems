"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const flex_demand_1 = require("./flex_demand");
(0, node_test_1.describe)("flex demand slots", () => {
    (0, node_test_1.it)("estimates immersion energy from temperature delta", () => {
        const kwh = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700);
        strict_1.default.equal(kwh, round3(10 * flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C));
    });
    (0, node_test_1.it)("returns zero when already at target", () => {
        strict_1.default.equal((0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(60, 60, 1700), 0);
    });
    (0, node_test_1.it)("caps by max power and day window", () => {
        const kwh = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(10, 100, 1700);
        strict_1.default.equal(kwh, round3((1700 / 1000) * 18));
    });
    (0, node_test_1.it)("adds a learned loss margin when the thermal model is valid", () => {
        const base = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700);
        const withMargin = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "valid",
            coolingRateCPerHAvg: 1.2,
        });
        strict_1.default.ok(withMargin > base);
        strict_1.default.equal(withMargin, round3(base + round3(1.2 * 0.25) * flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C));
    });
    (0, node_test_1.it)("ignores the learning margin when the model is degraded or missing", () => {
        const base = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700);
        const degraded = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "degraded",
            coolingRateCPerHAvg: 1.2,
        });
        const missing = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "missing",
            coolingRateCPerHAvg: null,
        });
        strict_1.default.equal(degraded, base);
        strict_1.default.equal(missing, base);
    });
    (0, node_test_1.it)("still returns zero at target even with a learning margin supplied", () => {
        const kwh = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(60, 60, 1700, {
            status: "valid",
            coolingRateCPerHAvg: 1.2,
        });
        strict_1.default.equal(kwh, 0);
    });
    (0, node_test_1.it)("builds a single demand slot when energy and power are valid", () => {
        const quality = (0, quality_1.operatorQuality)("valid", "OK");
        const slots = (0, flex_demand_1.buildFlexibleDemandSlot)({
            generatedAt: "2026-07-11T10:00:00.000Z",
            requiredEnergyKwh: 2.5,
            maxPowerW: 1700,
            available: true,
            quality,
            reasonDe: "OK",
        });
        strict_1.default.equal(slots.length, 1);
        strict_1.default.equal(slots[0].requiredEnergyKwh, 2.5);
        strict_1.default.equal(slots[0].maxPowerW, 1700);
    });
    (0, node_test_1.it)("returns empty slots when unavailable", () => {
        const quality = (0, quality_1.operatorQuality)("disabled", "Aus");
        const slots = (0, flex_demand_1.buildFlexibleDemandSlot)({
            generatedAt: "2026-07-11T10:00:00.000Z",
            requiredEnergyKwh: 2.5,
            maxPowerW: 1700,
            available: false,
            quality,
            reasonDe: "Aus",
        });
        strict_1.default.equal(slots.length, 0);
    });
});
function round3(n) {
    return Math.round(n * 1000) / 1000;
}

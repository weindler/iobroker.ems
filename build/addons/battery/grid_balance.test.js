"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_balance_js_1 = require("./grid_balance.js");
(0, node_test_1.describe)("grid balance", () => {
    const baseInputs = {
        effectiveRestOfDayKwh: 15,
        capacityWh: 10_000,
        snowCoverSuspected: false,
        consumptionW: 2000,
        pvAcPowerW: 500,
        socPct: 50,
        emsGridBalanceEnabled: true,
        adapterFeatureEnabled: true,
        controller: "grid_balance",
        offsetHighSocW: 25,
        offsetLowSocW: 10,
        socThresholdPct: 20,
        evccCharging: false,
        batteryHoldActive: false,
        winterGridPlanActive: false,
        mode1Active: false,
        priceNowCt: 22,
        priceMedianCt: 28,
        priceGate: { enabled: true, maxPriceCtPerKwh: null, medianFactor: 1.05 },
    };
    (0, node_test_1.it)("resolves controller to idle when suppressed", () => {
        strict_1.default.equal((0, grid_balance_js_1.resolveController)({
            emsBatteryIntentActive: false,
            emsGridBalanceEnabled: true,
            adapterFeatureEnabled: true,
            batteryAddonEnabled: true,
            gridBalancePaused: false,
            gridBalanceSuppressed: true,
        }), "idle");
    });
    (0, node_test_1.it)("blocks on evcc charging", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)({ ...baseInputs, evccCharging: true });
        strict_1.default.equal(r.gatePassed, false);
        strict_1.default.match(r.reasonDe, /EVCC/);
    });
    (0, node_test_1.it)("passes price gate on absolute threshold", () => {
        const r = (0, grid_balance_js_1.evaluateGridBalancePriceGate)({
            gate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 0 },
            priceNowCt: 22,
            referenceMedianCt: 40,
        });
        strict_1.default.equal(r.passed, true);
    });
    (0, node_test_1.it)("passes price gate on median factor", () => {
        const r = (0, grid_balance_js_1.evaluateGridBalancePriceGate)({
            gate: { enabled: true, maxPriceCtPerKwh: null, medianFactor: 1.05 },
            priceNowCt: 29,
            referenceMedianCt: 28,
        });
        strict_1.default.equal(r.passed, true);
    });
    (0, node_test_1.it)("rejects expensive price when gate enabled", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)({
            ...baseInputs,
            priceNowCt: 45,
            priceMedianCt: 30,
            priceGate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 1.0 },
        });
        strict_1.default.equal(r.gatePassed, false);
        strict_1.default.match(r.reasonDe, /Preis/);
    });
    (0, node_test_1.it)("computes target when all gates pass", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)(baseInputs);
        strict_1.default.equal(r.gatePassed, true);
        strict_1.default.ok(r.targetBatteryChargingW > 0);
    });
    (0, node_test_1.it)("computes median from slots", () => {
        const m = (0, grid_balance_js_1.medianCtFromPriceSlots)([
            { slotStartMs: 0, priceCtPerKwh: 20 },
            { slotStartMs: 1, priceCtPerKwh: 30 },
            { slotStartMs: 2, priceCtPerKwh: 40 },
        ]);
        strict_1.default.equal(m, 30);
    });
});

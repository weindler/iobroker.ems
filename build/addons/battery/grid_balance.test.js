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
        dailyPlanAuthoritative: false,
        priceNowCt: 36.7,
        minPriceCtPerKwh: 30,
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
    (0, node_test_1.it)("does not treat an authoritative Daily Plan as a competing battery action", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)({ ...baseInputs, dailyPlanAuthoritative: true });
        strict_1.default.equal(r.gatePassed, true);
        strict_1.default.ok(r.targetDischargeW > 0);
        strict_1.default.equal(r.checksFailed.includes("daily_plan_authoritative"), false);
    });
    (0, node_test_1.it)("allows price at and above the minimum", () => {
        strict_1.default.equal((0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 30 }).passed, true);
        strict_1.default.equal((0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 36.7 }).passed, true);
        strict_1.default.equal((0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 50 }).passed, true);
    });
    (0, node_test_1.it)("blocks price below the minimum", () => {
        strict_1.default.equal((0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 20 }).passed, false);
        strict_1.default.equal((0, grid_balance_js_1.evaluateGridBalanceMinPrice)({ minPriceCtPerKwh: 30, priceNowCt: 29.99 }).passed, false);
    });
    (0, node_test_1.it)("rejects cheap price when computing target", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)({
            ...baseInputs,
            priceNowCt: 20,
            minPriceCtPerKwh: 30,
        });
        strict_1.default.equal(r.gatePassed, false);
        strict_1.default.match(r.reasonDe, /Mindestpreis/);
        strict_1.default.ok(r.checksFailed.includes("price_below_minimum"));
    });
    (0, node_test_1.it)("computes target when all gates pass", () => {
        const r = (0, grid_balance_js_1.computeGridBalanceTarget)(baseInputs);
        strict_1.default.equal(r.gatePassed, true);
        strict_1.default.ok(r.targetDischargeW > 0);
    });
});

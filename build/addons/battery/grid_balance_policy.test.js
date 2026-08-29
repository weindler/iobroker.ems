"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const grid_balance_policy_js_1 = require("./grid_balance_policy.js");
(0, node_test_1.describe)("grid balance policy load adjustment (Phase 1)", () => {
    (0, node_test_1.it)("leaves load unchanged when no consumer is excluded", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: true, commandedPowerW: 1700 }],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 2000);
        strict_1.default.equal(r.excludedLoadW, 0);
        strict_1.default.deepEqual(r.excludedConsumerIds, []);
        strict_1.default.equal(r.reasonDe, "");
    });
    (0, node_test_1.it)("subtracts commanded power of a policy-disallowed consumer (Heizstab-Fall)", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 300);
        strict_1.default.equal(r.excludedLoadW, 1700);
        strict_1.default.deepEqual(r.excludedConsumerIds, ["immersion_heater"]);
        strict_1.default.match(r.reasonDe, /immersion_heater \(1700 W\)/);
        strict_1.default.match(r.reasonDe, /Policy: Batterie für diesen Verbraucher nicht erlaubt/);
    });
    (0, node_test_1.it)("clamps to zero instead of going negative", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 500,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 0);
        strict_1.default.equal(r.excludedLoadW, 1700);
    });
    (0, node_test_1.it)("ignores disallowed consumer with zero/null commanded power", () => {
        const r1 = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 0 }],
        });
        strict_1.default.equal(r1.policyAdjustedConsumptionW, 2000);
        strict_1.default.equal(r1.excludedLoadW, 0);
        const r2 = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: null }],
        });
        strict_1.default.equal(r2.policyAdjustedConsumptionW, 2000);
        strict_1.default.equal(r2.excludedLoadW, 0);
    });
    (0, node_test_1.it)("sums multiple excluded consumers (Erweiterbarkeit für spätere Add-ons)", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 5000,
            excludedConsumers: [
                { id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 },
                { id: "air_conditioning.unit_1", allowedOnBattery: false, commandedPowerW: 800 },
                { id: "wallbox", allowedOnBattery: true, commandedPowerW: 3000 },
            ],
        });
        strict_1.default.equal(r.excludedLoadW, 2500);
        strict_1.default.equal(r.policyAdjustedConsumptionW, 2500);
        strict_1.default.deepEqual(r.excludedConsumerIds, ["immersion_heater", "air_conditioning.unit_1"]);
    });
    (0, node_test_1.it)("treats non-finite raw consumption as zero", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: Number.NaN,
            excludedConsumers: [],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 0);
        strict_1.default.equal(r.excludedLoadW, 0);
    });
});

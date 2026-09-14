"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const grid_balance_policy_js_1 = require("./grid_balance_policy.js");
(0, node_test_1.describe)("grid balance uses the physical whole-house load", () => {
    (0, node_test_1.it)("preserves explicit permission parsing for compatibility", () => {
        strict_1.default.equal((0, grid_balance_policy_js_1.parseExplicitBatteryPermission)(true), true);
        strict_1.default.equal((0, grid_balance_policy_js_1.parseExplicitBatteryPermission)(false), false);
        for (const raw of [null, undefined, 0, 1, "true", "false", ""]) {
            strict_1.default.equal((0, grid_balance_policy_js_1.parseExplicitBatteryPermission)(raw), null);
        }
    });
    (0, node_test_1.it)("does not subtract a running heater when battery support is denied", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 }],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 2000);
        strict_1.default.equal(r.excludedLoadW, 0);
        strict_1.default.deepEqual(r.excludedConsumerIds, []);
        strict_1.default.equal(r.reasonDe, "");
    });
    (0, node_test_1.it)("does not subtract a running heater when permission is temporarily unknown", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 2000,
            excludedConsumers: [{ id: "immersion_heater", allowedOnBattery: null, commandedPowerW: 1700 }],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 2000);
        strict_1.default.equal(r.excludedLoadW, 0);
    });
    (0, node_test_1.it)("keeps all simultaneous household consumers in the control load", () => {
        const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
            rawConsumptionW: 5000,
            excludedConsumers: [
                { id: "immersion_heater", allowedOnBattery: false, commandedPowerW: 1700 },
                { id: "air_conditioning.unit_1", allowedOnBattery: false, commandedPowerW: 800 },
                { id: "wallbox", allowedOnBattery: true, commandedPowerW: 3000 },
            ],
        });
        strict_1.default.equal(r.policyAdjustedConsumptionW, 5000);
        strict_1.default.equal(r.excludedLoadW, 0);
    });
    (0, node_test_1.it)("clamps invalid or negative raw consumption to zero", () => {
        for (const rawConsumptionW of [Number.NaN, -500]) {
            const r = (0, grid_balance_policy_js_1.resolveGridBalancePolicyLoadAdjustment)({
                rawConsumptionW,
                excludedConsumers: [],
            });
            strict_1.default.equal(r.policyAdjustedConsumptionW, 0);
            strict_1.default.equal(r.excludedLoadW, 0);
        }
    });
});

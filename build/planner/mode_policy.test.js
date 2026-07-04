"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const mode_policy_js_1 = require("./mode_policy.js");
(0, node_test_1.describe)("planner mode policy", () => {
    (0, node_test_1.it)("off disables optimization", () => {
        const p = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("off");
        strict_1.default.equal(p.allowOptimization, false);
        strict_1.default.equal(p.allowThermalAuto, false);
    });
    (0, node_test_1.it)("comfort supports deficit", () => {
        const p = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("comfort");
        strict_1.default.equal(p.supportBatteryOnDeficit, true);
        strict_1.default.equal(p.batteryMinSocForDeficitPct, 15);
    });
    (0, node_test_1.it)("forced supports deficit with lower reserve", () => {
        const p = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("forced");
        strict_1.default.equal(p.supportBatteryOnDeficit, true);
        strict_1.default.equal(p.chargeTargetSocPct, 98);
    });
    (0, node_test_1.it)("invalid falls back to balanced", () => {
        const p = (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("invalid");
        strict_1.default.equal(p.mode, "balanced");
    });
});

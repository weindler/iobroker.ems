"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const limits_js_1 = require("./limits.js");
(0, node_test_1.describe)("battery hardware limits", () => {
    (0, node_test_1.it)("valid limits accepted", () => {
        const l = (0, limits_js_1.hardwareLimitsFromConfig)({
            bat_hw_max_charge_w: 5000,
            bat_hw_max_discharge_w: 5000,
            bat_hw_min_soc_pct: 5,
            bat_hw_max_soc_pct: 100,
        });
        strict_1.default.equal(l.valid, true);
        strict_1.default.deepEqual(l.issues, []);
    });
    (0, node_test_1.it)("rejects max_charge_w <= 0", () => {
        const l = (0, limits_js_1.hardwareLimitsFromConfig)({ bat_hw_max_charge_w: 0, bat_hw_min_soc_pct: 5, bat_hw_max_soc_pct: 100 });
        strict_1.default.equal(l.valid, false);
        strict_1.default.ok(l.issues.includes("max_charge_w_invalid"));
    });
    (0, node_test_1.it)("rejects min_soc >= max_soc", () => {
        const l = (0, limits_js_1.hardwareLimitsFromConfig)({
            bat_hw_max_charge_w: 5000,
            bat_hw_min_soc_pct: 90,
            bat_hw_max_soc_pct: 80,
        });
        strict_1.default.equal(l.valid, false);
        strict_1.default.ok(l.issues.includes("soc_limits_invalid"));
    });
    (0, node_test_1.it)("missing discharge means no discharge capability", () => {
        const l = (0, limits_js_1.hardwareLimitsFromConfig)({
            bat_hw_max_charge_w: 5000,
            bat_hw_min_soc_pct: 5,
            bat_hw_max_soc_pct: 100,
        });
        strict_1.default.equal((0, limits_js_1.hasDischargeCapability)(l), false);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_pv_cover_1 = require("./battery_pv_cover");
(0, node_test_1.describe)("battery PV cover", () => {
    (0, node_test_1.it)("computes today surplus as max(0, pv − load)", () => {
        strict_1.default.equal((0, battery_pv_cover_1.todayPvSurplusKwh)(20, 12), 8);
        strict_1.default.equal((0, battery_pv_cover_1.todayPvSurplusKwh)(10, 15), 0);
        strict_1.default.equal((0, battery_pv_cover_1.todayPvSurplusKwh)(null, 12), null);
        strict_1.default.equal((0, battery_pv_cover_1.todayPvSurplusKwh)(20, null), null);
    });
    (0, node_test_1.it)("covers charge need when surplus ≥ required and no top-off", () => {
        strict_1.default.equal((0, battery_pv_cover_1.pvSurplusCoversChargeNeed)({
            requiredChargeEnergyKwh: 4,
            todayPvSurplusKwh: 8,
            topOffRequested: false,
            learnedTopoffDue: false,
        }), true);
    });
    (0, node_test_1.it)("does not cover when surplus below need", () => {
        strict_1.default.equal((0, battery_pv_cover_1.pvSurplusCoversChargeNeed)({
            requiredChargeEnergyKwh: 4,
            todayPvSurplusKwh: 3,
            topOffRequested: false,
            learnedTopoffDue: false,
        }), false);
    });
    (0, node_test_1.it)("keeps EMS slots when top-off is requested or learned due", () => {
        strict_1.default.equal((0, battery_pv_cover_1.pvSurplusCoversChargeNeed)({
            requiredChargeEnergyKwh: 1,
            todayPvSurplusKwh: 20,
            topOffRequested: true,
            learnedTopoffDue: false,
        }), false);
        strict_1.default.equal((0, battery_pv_cover_1.pvSurplusCoversChargeNeed)({
            requiredChargeEnergyKwh: 1,
            todayPvSurplusKwh: 20,
            topOffRequested: false,
            learnedTopoffDue: true,
        }), false);
    });
});

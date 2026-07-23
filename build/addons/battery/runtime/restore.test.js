"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const restore_js_1 = require("./restore.js");
const ownership_js_1 = require("./ownership.js");
(0, node_test_1.describe)("planSafeRestore", () => {
    (0, node_test_1.it)("not required without EMS ownership", () => {
        const plan = (0, restore_js_1.planSafeRestore)({ ownership: (0, ownership_js_1.emptyOwnership)(), gridBalanceWasActive: false });
        strict_1.default.equal(plan.required, false);
        strict_1.default.equal(plan.stopCharge, false);
        strict_1.default.equal(plan.setSelfConsumption, false);
        strict_1.default.equal(plan.restoreGridBalance, false);
        strict_1.default.equal(plan.reason, "no_ownership");
    });
    (0, node_test_1.it)("not required when EMS is active but never wrote manual mode itself", () => {
        const ownership = { ...(0, ownership_js_1.emptyOwnership)(), active: true, manualModeWritten: false };
        const plan = (0, restore_js_1.planSafeRestore)({ ownership, gridBalanceWasActive: false });
        strict_1.default.equal(plan.required, false);
        strict_1.default.equal(plan.reason, "no_ownership");
    });
    (0, node_test_1.it)("requires stop_charge + self_consumption once EMS wrote manual mode", () => {
        const ownership = { ...(0, ownership_js_1.emptyOwnership)(), active: true, manualModeWritten: true };
        const plan = (0, restore_js_1.planSafeRestore)({ ownership, gridBalanceWasActive: false });
        strict_1.default.equal(plan.required, true);
        strict_1.default.equal(plan.stopCharge, true);
        strict_1.default.equal(plan.setSelfConsumption, true);
        strict_1.default.equal(plan.restoreGridBalance, false);
        strict_1.default.equal(plan.reason, "ems_ownership");
    });
    (0, node_test_1.it)("restores grid balance only if it was paused by the FSM", () => {
        const ownership = { ...(0, ownership_js_1.emptyOwnership)(), active: true, manualModeWritten: true };
        const plan = (0, restore_js_1.planSafeRestore)({ ownership, gridBalanceWasActive: true });
        strict_1.default.equal(plan.restoreGridBalance, true);
    });
});

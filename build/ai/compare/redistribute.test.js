"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const redistribute_js_1 = require("./redistribute.js");
(0, node_test_1.describe)("computeSlotWeight", () => {
    (0, node_test_1.it)("multiplier=1 (neutral) → weight equals ownW regardless of capacity headroom", () => {
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(300, 300, 1), 300);
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(300, 900, 1), 300);
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(0, 900, 1), 0);
    });
    (0, node_test_1.it)("multiplier=0 (avoid) → weight is always 0", () => {
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(300, 900, 0), 0);
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(0, 900, 0), 0);
    });
    (0, node_test_1.it)("multiplier>1 grants proportional access to unused headroom", () => {
        // ownW=0, capacity=500 → extra=500, weight = 0*2 + 500*(2-1) = 500.
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(0, 500, 2), 500);
        // ownW=200, capacity=500 → extra=300, weight = 200*2 + 300*1 = 700.
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(200, 500, 2), 700);
    });
    (0, node_test_1.it)("clamps multiplier to [0,3]", () => {
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(100, 100, 10), (0, redistribute_js_1.computeSlotWeight)(100, 100, 3));
        strict_1.default.equal((0, redistribute_js_1.computeSlotWeight)(100, 100, -5), (0, redistribute_js_1.computeSlotWeight)(100, 100, 0));
    });
});
(0, node_test_1.describe)("waterFillProportional", () => {
    (0, node_test_1.it)("distributes proportionally to weights when nothing is capacity-constrained", () => {
        const result = (0, redistribute_js_1.waterFillProportional)([1, 3], [1000, 1000], 400);
        strict_1.default.equal(result[0], 100);
        strict_1.default.equal(result[1], 300);
    });
    (0, node_test_1.it)("clamps a slot at its capacity and redistributes the remainder to others", () => {
        // slot 0 wants (weight 3 of total 4) * 400 = 300 but only has 100 capacity.
        const result = (0, redistribute_js_1.waterFillProportional)([3, 1], [100, 1000], 400);
        strict_1.default.equal(result[0], 100);
        strict_1.default.equal(result[1], 300);
    });
    (0, node_test_1.it)("never exceeds total available capacity", () => {
        const result = (0, redistribute_js_1.waterFillProportional)([1, 1], [50, 50], 1000);
        strict_1.default.equal(result[0], 50);
        strict_1.default.equal(result[1], 50);
    });
    (0, node_test_1.it)("zero weight slots with zero total input get nothing, no NaN/negative values", () => {
        const result = (0, redistribute_js_1.waterFillProportional)([0, 0], [100, 100], 0);
        strict_1.default.deepEqual(result, [0, 0]);
    });
    (0, node_test_1.it)("skips zero-weight (avoided) slots even if they have capacity", () => {
        const result = (0, redistribute_js_1.waterFillProportional)([0, 1], [100, 100], 60);
        strict_1.default.equal(result[0], 0);
        strict_1.default.equal(result[1], 60);
    });
    (0, node_test_1.it)("still conserves total energy via capacity fallback when every slot has zero weight", () => {
        // No positive weight anywhere (e.g. AI avoided everything without a clear alternative) —
        // energy conservation must still hold, distributed by leftover capacity.
        const result = (0, redistribute_js_1.waterFillProportional)([0, 0], [300, 100], 400);
        strict_1.default.equal(result[0] + result[1], 400);
        strict_1.default.ok(result[0] <= 300);
        strict_1.default.ok(result[1] <= 100);
    });
});
(0, node_test_1.describe)("redistributeAddonAcrossSlots", () => {
    (0, node_test_1.it)("reproduces Plan A exactly when all multipliers are neutral (1)", () => {
        const slots = [
            { ownW: 500, capacityW: 500 },
            { ownW: 0, capacityW: 800 },
            { ownW: 200, capacityW: 1000 },
        ];
        const result = (0, redistribute_js_1.redistributeAddonAcrossSlots)(slots, [1, 1, 1]);
        strict_1.default.deepEqual(result, [500, 0, 200]);
    });
    (0, node_test_1.it)("shifts energy away from an avoided slot into slots with capacity headroom", () => {
        const slots = [
            { ownW: 400, capacityW: 400 },
            { ownW: 0, capacityW: 600 },
        ];
        // avoid slot 0 entirely → its 400W must move to slot 1 (which has headroom for it).
        const result = (0, redistribute_js_1.redistributeAddonAcrossSlots)(slots, [0, 2]);
        strict_1.default.equal(result[0], 0);
        strict_1.default.equal(result[1], 400);
    });
    (0, node_test_1.it)("conserves total energy across all slots regardless of weighting", () => {
        const slots = [
            { ownW: 300, capacityW: 900 },
            { ownW: 100, capacityW: 900 },
            { ownW: 0, capacityW: 900 },
        ];
        const totalBefore = slots.reduce((s, x) => s + x.ownW, 0);
        const result = (0, redistribute_js_1.redistributeAddonAcrossSlots)(slots, [3, 1, 0.2]);
        const totalAfter = result.reduce((s, x) => s + x, 0);
        strict_1.default.ok(Math.abs(totalAfter - totalBefore) < 1e-6);
    });
    (0, node_test_1.it)("never assigns more than a slot's own capacity", () => {
        const slots = [
            { ownW: 100, capacityW: 150 },
            { ownW: 300, capacityW: 900 },
        ];
        const result = (0, redistribute_js_1.redistributeAddonAcrossSlots)(slots, [3, 1]);
        strict_1.default.ok(result[0] <= 150);
        strict_1.default.ok(result[1] <= 900);
    });
});

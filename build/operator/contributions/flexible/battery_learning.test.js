"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_learning_1 = require("./battery_learning");
(0, node_test_1.describe)("battery learning signal", () => {
    (0, node_test_1.it)("returns missing without a learning model (no source)", () => {
        const signal = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "no_source",
            sampleDays: 0,
            avgNightDischargeKwh: null,
            avgChargePowerW: null,
            maxChargePowerW: null,
            topoffDueRaw: null,
            topoffDaysRemaining: null,
            estimatedRuntimeDays: null,
        });
        strict_1.default.equal(signal.status, "missing");
        strict_1.default.equal(signal.topoffDue, null);
        strict_1.default.equal(signal.avgNightDischargeKwh, null);
    });
    (0, node_test_1.it)("returns missing when disabled in admin", () => {
        const signal = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "disabled",
            sampleDays: 0,
            avgNightDischargeKwh: null,
            avgChargePowerW: null,
            maxChargePowerW: null,
            topoffDueRaw: null,
            topoffDaysRemaining: null,
            estimatedRuntimeDays: null,
        });
        strict_1.default.equal(signal.status, "missing");
    });
    (0, node_test_1.it)("returns degraded with insufficient history", () => {
        const signal = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "insufficient_data",
            sampleDays: 2,
            avgNightDischargeKwh: 1.5,
            avgChargePowerW: 2500,
            maxChargePowerW: 3000,
            topoffDueRaw: 0,
            topoffDaysRemaining: 12,
            estimatedRuntimeDays: 8,
        });
        strict_1.default.equal(signal.status, "degraded");
        strict_1.default.equal(signal.avgNightDischargeKwh, 1.5);
        strict_1.default.equal(signal.topoffDue, false);
    });
    (0, node_test_1.it)("returns valid with sufficient history and maps topoff_due 1/0 to boolean", () => {
        const due = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "ready",
            sampleDays: 30,
            avgNightDischargeKwh: 2.1,
            avgChargePowerW: 2800,
            maxChargePowerW: 3200,
            topoffDueRaw: 1,
            topoffDaysRemaining: -3,
            estimatedRuntimeDays: 6,
        });
        strict_1.default.equal(due.status, "valid");
        strict_1.default.equal(due.topoffDue, true);
        strict_1.default.equal(due.topoffDaysRemaining, -3);
        const notDue = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "ready",
            sampleDays: 30,
            avgNightDischargeKwh: 2.1,
            avgChargePowerW: 2800,
            maxChargePowerW: 3200,
            topoffDueRaw: 0,
            topoffDaysRemaining: 5,
            estimatedRuntimeDays: 6,
        });
        strict_1.default.equal(notDue.topoffDue, false);
    });
    (0, node_test_1.it)("keeps topoffDue null when the raw state was never written", () => {
        const signal = (0, battery_learning_1.buildBatteryLearningSignal)({
            rawStatus: "ready",
            sampleDays: 30,
            avgNightDischargeKwh: 2.1,
            avgChargePowerW: 2800,
            maxChargePowerW: 3200,
            topoffDueRaw: null,
            topoffDaysRemaining: null,
            estimatedRuntimeDays: null,
        });
        strict_1.default.equal(signal.status, "valid");
        strict_1.default.equal(signal.topoffDue, null);
    });
});

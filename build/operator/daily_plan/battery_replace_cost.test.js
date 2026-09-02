"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_replace_cost_js_1 = require("./battery_replace_cost.js");
const now = Date.parse("2026-01-10T18:00:00Z");
function slots(pairs) {
    return pairs.map(([h, ct]) => ({ startMs: now + h * 3600_000, importCtPerKwh: ct }));
}
(0, node_test_1.describe)("C_replace paths", () => {
    (0, node_test_1.it)("surplus_export wenn PV die Batterie ohnehin füllt", () => {
        const r = (0, battery_replace_cost_js_1.evaluateBatteryReplaceCost)({
            nowMs: now,
            priceSlots: slots([[2, 40]]),
            headroomAboveReserveKwh: 4,
            pvRemainingTodayKwh: 12,
            plannedLaterDemandKwh: 0,
            predictedConsumptionUntilNextPvKwh: 1,
            feedInCtPerKwh: 9.3,
            gridChargeAllowed: false,
            etaPvPath: 0.92,
            etaGridPath: 0.92,
            usableCapacityKwh: 10,
            socPct: 80,
            maxSocPct: 100,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.path, "surplus_export");
        strict_1.default.ok(r.valueCtPerKwh != null && r.valueCtPerKwh > 9);
    });
    (0, node_test_1.it)("later_avoided_import wenn Extra-kWh später teuren Bezug verhindert", () => {
        const r = (0, battery_replace_cost_js_1.evaluateBatteryReplaceCost)({
            nowMs: now,
            priceSlots: slots([
                [2, 20],
                [6, 42],
            ]),
            headroomAboveReserveKwh: 0.3,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 2,
            predictedConsumptionUntilNextPvKwh: 3,
            feedInCtPerKwh: 9.3,
            gridChargeAllowed: false,
            etaPvPath: 0.92,
            etaGridPath: 0.92,
            usableCapacityKwh: 10,
            socPct: 55,
            maxSocPct: 100,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.path, "later_avoided_import");
        strict_1.default.equal(r.valueCtPerKwh, 42);
    });
    (0, node_test_1.it)("grid_charge über günstiges Fenster / η", () => {
        const r = (0, battery_replace_cost_js_1.evaluateBatteryReplaceCost)({
            nowMs: now,
            priceSlots: slots([
                [2, 18],
                [8, 36],
            ]),
            headroomAboveReserveKwh: 4,
            pvRemainingTodayKwh: 0.2,
            plannedLaterDemandKwh: 0,
            predictedConsumptionUntilNextPvKwh: 0.4,
            feedInCtPerKwh: 9.3,
            gridChargeAllowed: true,
            etaPvPath: 0.92,
            etaGridPath: 0.92,
            usableCapacityKwh: 10,
            socPct: 70,
            maxSocPct: 100,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.path, "grid_charge");
        strict_1.default.ok(r.valueCtPerKwh != null);
        strict_1.default.ok(Math.abs(r.valueCtPerKwh - 18 / 0.92) < 0.05);
    });
    (0, node_test_1.it)("nicht usable ohne dominanten Pfad", () => {
        const r = (0, battery_replace_cost_js_1.evaluateBatteryReplaceCost)({
            nowMs: now,
            priceSlots: [],
            headroomAboveReserveKwh: null,
            pvRemainingTodayKwh: null,
            plannedLaterDemandKwh: null,
            predictedConsumptionUntilNextPvKwh: null,
            feedInCtPerKwh: null,
            gridChargeAllowed: false,
            etaPvPath: 0.92,
            etaGridPath: 0.92,
            usableCapacityKwh: null,
            socPct: null,
            maxSocPct: null,
        });
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.path, null);
        strict_1.default.equal(r.valueCtPerKwh, null);
    });
});

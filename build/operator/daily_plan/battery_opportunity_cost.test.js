"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_opportunity_cost_js_1 = require("./battery_opportunity_cost.js");
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
function slot(hOffset, ct) {
    return { startMs: NOW + hOffset * 3600_000, importCtPerKwh: ct };
}
(0, node_test_1.describe)("Block B — battery opportunity cost", () => {
    (0, node_test_1.it)("keine spätere Preisinformation → usable=false, Fallback 0", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [],
            headroomAboveReserveKwh: 2,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 0,
        });
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(r.opportunityCostCtPerKwh, 0);
        strict_1.default.ok(r.reasonCodes.includes("battery_opportunity_no_later_price_known"));
    });
    (0, node_test_1.it)("hoher späterer Preis-Peak, aber KEIN bekannter späterer Bedarf → deutlich abgeschlagen", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, 20), slot(2, 45), slot(3, 15)],
            headroomAboveReserveKwh: 2,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 0,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.ok(r.opportunityCostCtPerKwh < 45, `sollte abgeschlagen sein, got ${r.opportunityCostCtPerKwh}`);
        strict_1.default.ok(r.reasonCodes.includes("battery_opportunity_no_known_later_demand"));
    });
    (0, node_test_1.it)("hoher späterer Preis-Peak MIT bekanntem späteren Bedarf → voller Wert (gebunden)", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, 20), slot(2, 45), slot(3, 15)],
            headroomAboveReserveKwh: 2,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 1.5,
        });
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.opportunityCostCtPerKwh, 45);
        strict_1.default.ok(r.reasonCodes.includes("battery_opportunity_later_demand_or_pv_pending"));
    });
    (0, node_test_1.it)("Rest-PV allein reicht bereits, um vollen Wert anzusetzen (kein Demand-Discount)", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, 30)],
            headroomAboveReserveKwh: 1,
            pvRemainingTodayKwh: 5,
            plannedLaterDemandKwh: 0,
        });
        strict_1.default.equal(r.opportunityCostCtPerKwh, 30);
    });
    (0, node_test_1.it)("Bound gegen Scheingenauigkeit — extremer Preis wird gekappt", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, 500)],
            headroomAboveReserveKwh: 1,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 2,
        });
        strict_1.default.equal(r.opportunityCostCtPerKwh, battery_opportunity_cost_js_1.BATTERY_OPPORTUNITY_MAX_CT);
    });
    (0, node_test_1.it)("nie negativ, auch bei negativen/degenerierten Eingaben", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, -5)],
            headroomAboveReserveKwh: 1,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 0,
        });
        strict_1.default.ok(r.opportunityCostCtPerKwh >= battery_opportunity_cost_js_1.BATTERY_OPPORTUNITY_MIN_CT);
    });
    (0, node_test_1.it)("nur vergangene Preis-Slots (startMs <= nowMs) zählen nicht als 'später'", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [{ startMs: NOW - 3600_000, importCtPerKwh: 99 }, { startMs: NOW, importCtPerKwh: 99 }],
            headroomAboveReserveKwh: 1,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 1,
        });
        strict_1.default.equal(r.usable, false);
    });
    (0, node_test_1.it)("headroom unbekannt wird als Reason-Code vermerkt, blockiert aber nicht die Bewertung", () => {
        const r = (0, battery_opportunity_cost_js_1.evaluateBatteryOpportunityCost)({
            nowMs: NOW,
            priceSlots: [slot(1, 30)],
            headroomAboveReserveKwh: null,
            pvRemainingTodayKwh: 0,
            plannedLaterDemandKwh: 1,
        });
        strict_1.default.ok(r.reasonCodes.includes("battery_opportunity_headroom_unknown"));
        strict_1.default.equal(r.usable, true);
        strict_1.default.equal(r.headroomAboveReserveKwh, null);
    });
});

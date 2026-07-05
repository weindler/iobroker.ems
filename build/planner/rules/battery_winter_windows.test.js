"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_winter_windows_js_1 = require("./battery_winter_windows.js");
const tibber_parse_js_1 = require("../../learning/price_forecast/tibber_parse.js");
const BASE = Date.parse("2026-01-15T18:00:00.000Z");
function slot(offset15m, ct) {
    return { slotStartMs: BASE + offset15m * tibber_parse_js_1.MS_PER_15MIN, priceCtPerKwh: ct };
}
(0, node_test_1.describe)("battery winter price windows", () => {
    (0, node_test_1.it)("picks cheapest contiguous block for balanced mode", () => {
        const slots = [slot(0, 30), slot(1, 20), slot(2, 19), slot(3, 21), slot(4, 35)];
        const windows = (0, battery_winter_windows_js_1.planBatteryWinterPriceWindows)({
            nowMs: BASE,
            slots,
            slotsNeeded: 2,
            deadlineMs: BASE + 5 * tibber_parse_js_1.MS_PER_15MIN,
            globalMode: "balanced",
        });
        strict_1.default.equal(windows.length, 1);
        strict_1.default.equal(windows[0].strategy, "contiguous");
        strict_1.default.equal(windows[0].slots_15m, 2);
        strict_1.default.equal(Date.parse(windows[0].start_iso), slot(1, 0).slotStartMs);
    });
    (0, node_test_1.it)("allows split windows in eco mode", () => {
        const slots = [slot(0, 40), slot(1, 15), slot(2, 50), slot(3, 14)];
        const windows = (0, battery_winter_windows_js_1.planBatteryWinterPriceWindows)({
            nowMs: BASE,
            slots,
            slotsNeeded: 2,
            deadlineMs: BASE + 4 * tibber_parse_js_1.MS_PER_15MIN,
            globalMode: "eco",
        });
        strict_1.default.ok(windows.length >= 1);
        strict_1.default.equal(windows[0].strategy, "split");
        strict_1.default.equal(windows.reduce((n, w) => n + w.slots_15m, 0), 2);
    });
    (0, node_test_1.it)("detects active window for current time", () => {
        const windows = (0, battery_winter_windows_js_1.groupContiguousSlotWindows)([slot(0, 10), slot(1, 11)], "contiguous");
        const active = (0, battery_winter_windows_js_1.isNowInWinterChargeWindow)(BASE + tibber_parse_js_1.MS_PER_15MIN / 2, windows);
        strict_1.default.ok(active);
        strict_1.default.equal((0, battery_winter_windows_js_1.isNowInWinterChargeWindow)(BASE + 3 * tibber_parse_js_1.MS_PER_15MIN, windows), null);
    });
});

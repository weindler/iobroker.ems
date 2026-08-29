"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("./slots.js");
(0, node_test_1.describe)("day_telemetry slots DST", () => {
    (0, node_test_1.it)("1) normaler Tag = 96 Slots (Europe/Berlin, kein DST-Wechsel)", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
        strict_1.default.equal(layout.slotCount, 96);
        strict_1.default.equal(layout.slots.length, 96);
        strict_1.default.equal(layout.endMs - layout.startMs, 96 * 15 * 60 * 1000);
    });
    (0, node_test_1.it)("2) DST Frühjahr = 92 Slots (2026-03-29 Europe/Berlin)", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-03-29", "Europe/Berlin");
        strict_1.default.equal(layout.slotCount, 92);
        strict_1.default.equal(layout.slots.length, 92);
    });
    (0, node_test_1.it)("3) DST Herbst = 100 Slots (2026-10-25 Europe/Berlin)", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-10-25", "Europe/Berlin");
        strict_1.default.equal(layout.slotCount, 100);
        strict_1.default.equal(layout.slots.length, 100);
        /* Doppelte lokale 02:xx — zwei verschiedene startMs */
        const starts = new Set(layout.slots.map((s) => s.startMs));
        strict_1.default.equal(starts.size, 100);
    });
    (0, node_test_1.it)("Slot-Index über absolute ms eindeutig", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-10-25", "Europe/Berlin");
        const mid = layout.slots[50];
        strict_1.default.equal((0, slots_js_1.slotIndexForMs)(layout, mid.startMs), 50);
        strict_1.default.equal((0, slots_js_1.slotIndexForMs)(layout, mid.endMs - 1), 50);
        strict_1.default.equal((0, slots_js_1.slotIndexForMs)(layout, layout.startMs - 1), null);
    });
});

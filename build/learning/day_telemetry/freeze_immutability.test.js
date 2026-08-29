"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const time_js_1 = require("../../operator/time.js");
const planned_freeze_js_1 = require("./planned_freeze.js");
const slots_js_1 = require("./slots.js");
const types_js_1 = require("./types.js");
(0, node_test_1.describe)("day_telemetry frozen slot immutability", () => {
    (0, node_test_1.it)("9) Replan nach Slotbeginn verändert Frozen Slot nicht", () => {
        const layout = (0, slots_js_1.buildDaySlotLayout)("2026-06-15", "Europe/Berlin");
        const day = (0, types_js_1.emptyDayRecord)("2026-06-15", "Europe/Berlin", layout.startMs, layout.endMs, layout.slotCount);
        const slotIdx = 40;
        const startIso = (0, time_js_1.isoFromMs)(layout.slots[slotIdx].startMs);
        const alloc1 = [
            {
                slot: { startIso, endIso: (0, time_js_1.isoFromMs)(layout.slots[slotIdx].endMs) },
                consumerId: "battery",
                kind: "battery_charge",
                allocatedPowerW: 2000,
                allocatedEnergyKwh: 0.5,
                energySource: "pv_surplus",
                constraintIds: [],
                reasonCodes: [],
            },
        ];
        const frozen1 = (0, planned_freeze_js_1.freezePlannedConsumersForSlot)(alloc1, startIso, null);
        const d1 = (0, planned_freeze_js_1.dedupePlannedConsumers)(day.plannedConsumers, frozen1);
        day.plannedConsumers = d1.table;
        day.buckets.plannedConsumersRef[slotIdx] = d1.index;
        const snapBefore = JSON.stringify(day.plannedConsumers[d1.index]);
        /* Späterer Replan mit anderer Allocation — Slot bereits eingefroren */
        const alloc2 = [
            {
                slot: { startIso, endIso: (0, time_js_1.isoFromMs)(layout.slots[slotIdx].endMs) },
                consumerId: "wallbox",
                kind: "wallbox",
                allocatedPowerW: 7000,
                allocatedEnergyKwh: 1.75,
                energySource: "grid",
                constraintIds: [],
                reasonCodes: [],
            },
        ];
        if (day.buckets.plannedConsumersRef[slotIdx] != null) {
            /* Recorder-Semantik: nicht überschreiben */
        }
        else {
            const frozen2 = (0, planned_freeze_js_1.freezePlannedConsumersForSlot)(alloc2, startIso, null);
            const d2 = (0, planned_freeze_js_1.dedupePlannedConsumers)(day.plannedConsumers, frozen2);
            day.plannedConsumers = d2.table;
            day.buckets.plannedConsumersRef[slotIdx] = d2.index;
        }
        strict_1.default.equal(JSON.stringify(day.plannedConsumers[day.buckets.plannedConsumersRef[slotIdx]]), snapBefore);
        strict_1.default.ok(snapBefore.includes("battery"));
        strict_1.default.equal(snapBefore.includes("wallbox"), false);
        void 0;
    });
});

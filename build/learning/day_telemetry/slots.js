"use strict";
/**
 * DST-sichere 15-Min-Slots über absolute Zeit (startMs/endMs).
 * Nutzt operator/time + daily_plan/slots (localDayBoundsMs / endOfLocalDayIso).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.overlappingSlotIndices = exports.slotIndexForMs = exports.buildDaySlotLayout = void 0;
const energy_scopes_1 = require("../../operator/daily_plan/unified/energy_scopes");
const constants_1 = require("./constants");
/** Baut Slot-Layout für einen lokalen Kalendertag (92/96/100 je nach DST). */
function buildDaySlotLayout(dateKey, timezone) {
    const { startMs, endMs } = (0, energy_scopes_1.localDayBoundsMs)(dateKey, timezone);
    const duration = endMs - startMs;
    if (!Number.isFinite(duration) || duration <= 0) {
        return { dateKey, timezone, startMs, endMs, slotCount: 0, slots: [] };
    }
    const slotCount = Math.round(duration / constants_1.DAY_TELEMETRY_SLOT_MS);
    const slots = [];
    for (let i = 0; i < slotCount; i++) {
        const s = startMs + i * constants_1.DAY_TELEMETRY_SLOT_MS;
        slots.push({ index: i, startMs: s, endMs: s + constants_1.DAY_TELEMETRY_SLOT_MS });
    }
    return { dateKey, timezone, startMs, endMs, slotCount, slots };
}
exports.buildDaySlotLayout = buildDaySlotLayout;
/** Slot-Index für absolute Zeit; null wenn außerhalb des Tages. */
function slotIndexForMs(layout, ms) {
    if (ms < layout.startMs || ms >= layout.endMs)
        return null;
    const idx = Math.floor((ms - layout.startMs) / constants_1.DAY_TELEMETRY_SLOT_MS);
    if (idx < 0 || idx >= layout.slotCount)
        return null;
    return idx;
}
exports.slotIndexForMs = slotIndexForMs;
/** Alle Slots, die [fromMs, toMs) überlappen. */
function overlappingSlotIndices(layout, fromMs, toMs) {
    if (!(toMs > fromMs))
        return [];
    const out = [];
    for (const s of layout.slots) {
        if (s.endMs <= fromMs || s.startMs >= toMs)
            continue;
        out.push(s);
    }
    return out;
}
exports.overlappingSlotIndices = overlappingSlotIndices;

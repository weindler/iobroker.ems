"use strict";
/**
 * Kanonische ausführbare Slot-Geometrie für Unified Day Plan.
 * Nur 15-Minuten-Zellen — Hauslast-Segmente dürfen die Timeline nicht verzerren.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executableGeometryRejectReasonDe = exports.isExecutableDailyEntry = exports.isExecutableUnifiedCell = exports.isExecutableAllocationGeometry = exports.expectedEnergyKwhForPower = exports.slotDurationHours = exports.isCanonicalQuarterTimeSlot = exports.isCanonicalQuarterSlot = exports.ENERGY_POWER_TOLERANCE_KWH = exports.CANONICAL_SLOT_H = exports.CANONICAL_SLOT_MS = void 0;
/** Ausführbare Slot-Dauer (ms). */
exports.CANONICAL_SLOT_MS = 15 * 60_000;
/** Ausführbare Slot-Dauer (Stunden) — konsistent mit score_allocate.SLOT_H. */
exports.CANONICAL_SLOT_H = 0.25;
/** Toleranz für Energy↔Power-Invariante (kWh), Rundung 3 Dezimalen. */
exports.ENERGY_POWER_TOLERANCE_KWH = 0.02;
function isCanonicalQuarterSlot(startIso, endIso) {
    const a = Date.parse(startIso);
    const b = Date.parse(endIso);
    return Number.isFinite(a) && Number.isFinite(b) && b - a === exports.CANONICAL_SLOT_MS;
}
exports.isCanonicalQuarterSlot = isCanonicalQuarterSlot;
function isCanonicalQuarterTimeSlot(slot) {
    return isCanonicalQuarterSlot(slot.startIso, slot.endIso);
}
exports.isCanonicalQuarterTimeSlot = isCanonicalQuarterTimeSlot;
function slotDurationHours(startIso, endIso) {
    const a = Date.parse(startIso);
    const b = Date.parse(endIso);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
        return null;
    return (b - a) / 3_600_000;
}
exports.slotDurationHours = slotDurationHours;
/** Erwartete Energie bei konstanter Leistung über Slotdauer. */
function expectedEnergyKwhForPower(powerW, durationHours) {
    return (powerW / 1000) * durationHours;
}
exports.expectedEnergyKwhForPower = expectedEnergyKwhForPower;
/**
 * Ausführbare Allocation: exakt 15 min und
 * allocatedEnergyKwh ≈ allocatedPowerW/1000 * 0.25.
 */
function isExecutableAllocationGeometry(slot) {
    if (!isCanonicalQuarterSlot(slot.startIso, slot.endIso))
        return false;
    const power = slot.allocatedPowerW;
    const energy = slot.allocatedEnergyKwh;
    if (power == null || !Number.isFinite(power) || power < 0)
        return false;
    if (energy == null || !Number.isFinite(energy) || energy < 0)
        return false;
    if (power === 0 && energy === 0)
        return true;
    const expected = expectedEnergyKwhForPower(power, exports.CANONICAL_SLOT_H);
    return Math.abs(energy - expected) <= exports.ENERGY_POWER_TOLERANCE_KWH;
}
exports.isExecutableAllocationGeometry = isExecutableAllocationGeometry;
function isExecutableUnifiedCell(cell) {
    return isExecutableAllocationGeometry({
        startIso: cell.slot.startIso,
        endIso: cell.slot.endIso,
        allocatedPowerW: cell.allocatedPowerW,
        allocatedEnergyKwh: cell.allocatedEnergyKwh,
    });
}
exports.isExecutableUnifiedCell = isExecutableUnifiedCell;
function isExecutableDailyEntry(entry) {
    return isExecutableAllocationGeometry({
        startIso: entry.slot.startIso,
        endIso: entry.slot.endIso,
        allocatedPowerW: entry.allocatedPowerW,
        allocatedEnergyKwh: entry.allocatedEnergyKwh,
    });
}
exports.isExecutableDailyEntry = isExecutableDailyEntry;
/** Reason wenn eine Allocation die Executable-Invariante verletzt. */
function executableGeometryRejectReasonDe(slot) {
    const hours = slotDurationHours(slot.startIso, slot.endIso);
    if (hours === null || !isCanonicalQuarterSlot(slot.startIso, slot.endIso)) {
        return `Nicht-ausführbare Slot-Geometrie (${hours != null ? `${hours.toFixed(2)} h` : "ungültig"}) — nur 15-Min-Slots.`;
    }
    const power = slot.allocatedPowerW ?? 0;
    const energy = slot.allocatedEnergyKwh ?? 0;
    const expected = expectedEnergyKwhForPower(power, exports.CANONICAL_SLOT_H);
    return `Energy/Power-Invariante verletzt: ${power} W / 15 min erwartet ~${expected.toFixed(3)} kWh, ist ${energy} kWh.`;
}
exports.executableGeometryRejectReasonDe = executableGeometryRejectReasonDe;

/**
 * Kanonische ausführbare Slot-Geometrie für Unified Day Plan.
 * Nur 15-Minuten-Zellen — Hauslast-Segmente dürfen die Timeline nicht verzerren.
 */

import type { OperatorTimeSlot } from "../../types";
import type { DailyAllocationEntry } from "../types";
import type { UnifiedAllocationCell } from "./types";

/** Ausführbare Slot-Dauer (ms). */
export const CANONICAL_SLOT_MS = 15 * 60_000;
/** Ausführbare Slot-Dauer (Stunden) — konsistent mit score_allocate.SLOT_H. */
export const CANONICAL_SLOT_H = 0.25;

/** Toleranz für Energy↔Power-Invariante (kWh), Rundung 3 Dezimalen. */
export const ENERGY_POWER_TOLERANCE_KWH = 0.02;

export function isCanonicalQuarterSlot(startIso: string, endIso: string): boolean {
	const a = Date.parse(startIso);
	const b = Date.parse(endIso);
	return Number.isFinite(a) && Number.isFinite(b) && b - a === CANONICAL_SLOT_MS;
}

export function isCanonicalQuarterTimeSlot(slot: OperatorTimeSlot): boolean {
	return isCanonicalQuarterSlot(slot.startIso, slot.endIso);
}

export function slotDurationHours(startIso: string, endIso: string): number | null {
	const a = Date.parse(startIso);
	const b = Date.parse(endIso);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
	return (b - a) / 3_600_000;
}

/** Erwartete Energie bei konstanter Leistung über Slotdauer. */
export function expectedEnergyKwhForPower(powerW: number, durationHours: number): number {
	return (powerW / 1000) * durationHours;
}

/**
 * Ausführbare Allocation: exakt 15 min und
 * allocatedEnergyKwh ≈ allocatedPowerW/1000 * 0.25.
 */
export function isExecutableAllocationGeometry(slot: {
	startIso: string;
	endIso: string;
	allocatedPowerW: number | null | undefined;
	allocatedEnergyKwh: number | null | undefined;
}): boolean {
	if (!isCanonicalQuarterSlot(slot.startIso, slot.endIso)) return false;
	const power = slot.allocatedPowerW;
	const energy = slot.allocatedEnergyKwh;
	if (power == null || !Number.isFinite(power) || power < 0) return false;
	if (energy == null || !Number.isFinite(energy) || energy < 0) return false;
	if (power === 0 && energy === 0) return true;
	const expected = expectedEnergyKwhForPower(power, CANONICAL_SLOT_H);
	return Math.abs(energy - expected) <= ENERGY_POWER_TOLERANCE_KWH;
}

export function isExecutableUnifiedCell(cell: UnifiedAllocationCell): boolean {
	return isExecutableAllocationGeometry({
		startIso: cell.slot.startIso,
		endIso: cell.slot.endIso,
		allocatedPowerW: cell.allocatedPowerW,
		allocatedEnergyKwh: cell.allocatedEnergyKwh,
	});
}

export function isExecutableDailyEntry(entry: DailyAllocationEntry): boolean {
	return isExecutableAllocationGeometry({
		startIso: entry.slot.startIso,
		endIso: entry.slot.endIso,
		allocatedPowerW: entry.allocatedPowerW,
		allocatedEnergyKwh: entry.allocatedEnergyKwh,
	});
}

/** Reason wenn eine Allocation die Executable-Invariante verletzt. */
export function executableGeometryRejectReasonDe(slot: {
	startIso: string;
	endIso: string;
	allocatedPowerW: number | null | undefined;
	allocatedEnergyKwh: number | null | undefined;
}): string {
	const hours = slotDurationHours(slot.startIso, slot.endIso);
	if (hours === null || !isCanonicalQuarterSlot(slot.startIso, slot.endIso)) {
		return `Nicht-ausführbare Slot-Geometrie (${hours != null ? `${hours.toFixed(2)} h` : "ungültig"}) — nur 15-Min-Slots.`;
	}
	const power = slot.allocatedPowerW ?? 0;
	const energy = slot.allocatedEnergyKwh ?? 0;
	const expected = expectedEnergyKwhForPower(power, CANONICAL_SLOT_H);
	return `Energy/Power-Invariante verletzt: ${power} W / 15 min erwartet ~${expected.toFixed(3)} kWh, ist ${energy} kWh.`;
}

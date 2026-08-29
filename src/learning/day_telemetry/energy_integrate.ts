/**
 * Zentrale Energie-Delta-/Integrationslogik für Tages-Telemetrie.
 *
 * - Zähler: volle Number-Präzision (kein early round3 wie energyCounterDeltaKwh)
 * - Leistung: powerW × Δt, anteilig über Slotgrenzen
 * - Lange Gaps: kein Erfinden von Konstantleistung
 */

import { DAY_TELEMETRY_KWH_DECIMALS, DAY_TELEMETRY_MAX_GAP_MS } from "./constants";
import type { DaySlotLayout } from "./slots";
import { overlappingSlotIndices } from "./slots";

/** Präzises Zähler-Delta — Round erst bei Persistenz, nicht vor Akkumulation. */
export function energyCounterDeltaPreciseKwh(
	previous: number | null,
	current: number | null,
): { deltaKwh: number | null; newBaseline: number | null; reset: boolean } {
	if (current === null || !Number.isFinite(current)) {
		return { deltaKwh: null, newBaseline: previous, reset: false };
	}
	if (previous === null || !Number.isFinite(previous)) {
		return { deltaKwh: 0, newBaseline: current, reset: false };
	}
	if (current + 0.05 < previous) {
		return { deltaKwh: 0, newBaseline: current, reset: true };
	}
	return { deltaKwh: current - previous, newBaseline: current, reset: false };
}

export function roundTelemetryKwh(kwh: number): number {
	const f = 10 ** DAY_TELEMETRY_KWH_DECIMALS;
	return Math.round(kwh * f) / f;
}

export type SlotEnergyShare = {
	slotIndex: number;
	energyKwh: number;
	overlapMs: number;
};

/**
 * Verteilt amountKwh proportional zur Zeitüberlappung auf alle betroffenen Slots.
 * Beispiel 14:14:45–14:15:45 → Anteile an beiden 15-Min-Slots.
 */
export function splitAmountAcrossSlots(
	layout: DaySlotLayout,
	fromMs: number,
	toMs: number,
	amountKwh: number,
): SlotEnergyShare[] {
	if (!Number.isFinite(amountKwh) || !(toMs > fromMs)) return [];
	const span = toMs - fromMs;
	const overlaps = overlappingSlotIndices(layout, fromMs, toMs);
	const out: SlotEnergyShare[] = [];
	for (const s of overlaps) {
		const overlapStart = Math.max(s.startMs, fromMs);
		const overlapEnd = Math.min(s.endMs, toMs);
		const overlapMs = overlapEnd - overlapStart;
		if (overlapMs <= 0) continue;
		out.push({
			slotIndex: s.index,
			energyKwh: amountKwh * (overlapMs / span),
			overlapMs,
		});
	}
	return out;
}

/** powerW × Δt → kWh, dann split. */
export function integratePowerAcrossSlots(
	layout: DaySlotLayout,
	fromMs: number,
	toMs: number,
	powerW: number,
): SlotEnergyShare[] {
	if (!Number.isFinite(powerW) || !(toMs > fromMs)) return [];
	const hours = (toMs - fromMs) / 3_600_000;
	const kwh = (powerW * hours) / 1000;
	return splitAmountAcrossSlots(layout, fromMs, toMs, kwh);
}

export type GapDecision =
	| { kind: "ok"; fromMs: number; toMs: number }
	| { kind: "first_sample" }
	| { kind: "gap_too_long"; gapMs: number }
	| { kind: "invalid" };

/**
 * Entscheidet, ob ein Messintervall integriert werden darf.
 * Lange Gaps → missing, keine Konstantleistungs-Annahme.
 */
export function decideIntegrationGap(
	prevTs: number | null,
	curTs: number,
	maxGapMs: number = DAY_TELEMETRY_MAX_GAP_MS,
): GapDecision {
	if (!Number.isFinite(curTs)) return { kind: "invalid" };
	if (prevTs === null || !Number.isFinite(prevTs)) return { kind: "first_sample" };
	if (curTs <= prevTs) return { kind: "invalid" };
	const gap = curTs - prevTs;
	if (gap > maxGapMs) return { kind: "gap_too_long", gapMs: gap };
	return { kind: "ok", fromMs: prevTs, toMs: curTs };
}

/** Addiert energyKwh in ein Bucket-Array (null → Wert, sonst Summe). */
export function addToBucket(
	arr: Array<number | null>,
	index: number,
	energyKwh: number,
): void {
	if (index < 0 || index >= arr.length || !Number.isFinite(energyKwh)) return;
	const prev = arr[index];
	arr[index] = prev === null ? energyKwh : prev + energyKwh;
}

export function applySharesToBucket(arr: Array<number | null>, shares: SlotEnergyShare[]): void {
	for (const s of shares) {
		addToBucket(arr, s.slotIndex, s.energyKwh);
	}
}

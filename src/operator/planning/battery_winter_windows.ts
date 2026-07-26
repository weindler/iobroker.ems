/** @deprecated (Roadmap Block 2) Nur noch für den Legacy-Planner-Pfad — Allocation (Operator) übernimmt Preisfenster-Auswahl deadline-basiert. */
import type { Price15MinSlot } from "../../learning/price_forecast/tibber_parse";
import { MS_PER_15MIN } from "../../learning/price_forecast/tibber_parse";
import type { GlobalMode } from "../../global_modes/constants";
import type { BatteryWinterChargeWindow } from "./battery_winter";

export interface BatteryWinterWindowPlanInput {
	nowMs: number;
	slots: Price15MinSlot[];
	slotsNeeded: number;
	deadlineMs: number;
	globalMode: GlobalMode;
}

function slotEndMs(slot: Price15MinSlot): number {
	return slot.slotStartMs + MS_PER_15MIN;
}

function eligibleSlots(input: BatteryWinterWindowPlanInput): Price15MinSlot[] {
	const minStart = Math.floor(input.nowMs / MS_PER_15MIN) * MS_PER_15MIN;
	return input.slots.filter(
		(s) => s.slotStartMs >= minStart && slotEndMs(s) <= input.deadlineMs,
	);
}

function toWindow(slots: Price15MinSlot[], strategy: BatteryWinterChargeWindow["strategy"]): BatteryWinterChargeWindow {
	const sorted = [...slots].sort((a, b) => a.slotStartMs - b.slotStartMs);
	const start = sorted[0];
	const end = sorted[sorted.length - 1];
	return {
		start_iso: new Date(start.slotStartMs).toISOString(),
		end_iso: new Date(slotEndMs(end)).toISOString(),
		slots_15m: sorted.length,
		strategy,
	};
}

function avgPrice(slots: Price15MinSlot[]): number {
	if (slots.length === 0) return Number.POSITIVE_INFINITY;
	return slots.reduce((sum, s) => sum + s.priceCtPerKwh, 0) / slots.length;
}

function findBestContiguous(slots: Price15MinSlot[], count: number): Price15MinSlot[] | null {
	if (slots.length < count) return null;
	let best: Price15MinSlot[] | null = null;
	let bestAvg = Number.POSITIVE_INFINITY;
	for (let i = 0; i <= slots.length - count; i++) {
		const window = slots.slice(i, i + count);
		const contiguous =
			window.every((s, idx) => idx === 0 || s.slotStartMs - window[idx - 1].slotStartMs === MS_PER_15MIN);
		if (!contiguous) continue;
		const avg = avgPrice(window);
		if (avg < bestAvg) {
			bestAvg = avg;
			best = window;
		}
	}
	return best;
}

function findCheapestSplit(slots: Price15MinSlot[], count: number): Price15MinSlot[] {
	return [...slots].sort((a, b) => a.priceCtPerKwh - b.priceCtPerKwh || a.slotStartMs - b.slotStartMs).slice(0, count);
}

/** Gruppiert Slots in zusammenhängende Fenster (für split-Ausgabe). */
export function groupContiguousSlotWindows(
	slots: Price15MinSlot[],
	strategy: BatteryWinterChargeWindow["strategy"],
): BatteryWinterChargeWindow[] {
	if (slots.length === 0) return [];
	const sorted = [...slots].sort((a, b) => a.slotStartMs - b.slotStartMs);
	const groups: Price15MinSlot[][] = [];
	let current: Price15MinSlot[] = [];
	for (const slot of sorted) {
		if (
			current.length === 0 ||
			slot.slotStartMs - current[current.length - 1].slotStartMs === MS_PER_15MIN
		) {
			current.push(slot);
		} else {
			groups.push(current);
			current = [slot];
		}
	}
	if (current.length > 0) groups.push(current);
	return groups.map((g) => toWindow(g, strategy));
}

export function planBatteryWinterPriceWindows(input: BatteryWinterWindowPlanInput): BatteryWinterChargeWindow[] {
	const needed = Math.max(1, Math.round(input.slotsNeeded));
	const eligible = eligibleSlots(input);
	if (eligible.length < needed) {
		return [];
	}

	const preferSplit = input.globalMode === "eco";
	const allowSplitFallback = input.globalMode === "balanced" || input.globalMode === "eco";

	if (preferSplit) {
		const picked = findCheapestSplit(eligible, needed);
		return groupContiguousSlotWindows(picked, "split");
	}

	const contiguous = findBestContiguous(eligible, needed);
	if (contiguous) {
		return [toWindow(contiguous, "contiguous")];
	}
	if (allowSplitFallback) {
		const picked = findCheapestSplit(eligible, needed);
		return groupContiguousSlotWindows(picked, "split");
	}
	return [];
}

export function isNowInWinterChargeWindow(
	nowMs: number,
	windows: BatteryWinterChargeWindow[],
): BatteryWinterChargeWindow | null {
	for (const w of windows) {
		const start = Date.parse(w.start_iso);
		const end = Date.parse(w.end_iso);
		if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
		if (nowMs >= start && nowMs < end) {
			return w;
		}
	}
	return null;
}

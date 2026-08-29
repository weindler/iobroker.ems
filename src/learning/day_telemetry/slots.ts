/**
 * DST-sichere 15-Min-Slots über absolute Zeit (startMs/endMs).
 * Nutzt operator/time + daily_plan/slots (localDayBoundsMs / endOfLocalDayIso).
 */

import { localDayBoundsMs } from "../../operator/daily_plan/unified/energy_scopes";
import { DAY_TELEMETRY_SLOT_MS } from "./constants";

export type DaySlotBoundary = {
	index: number;
	startMs: number;
	endMs: number;
};

export type DaySlotLayout = {
	dateKey: string;
	timezone: string;
	startMs: number;
	endMs: number;
	slotCount: number;
	slots: DaySlotBoundary[];
};

/** Baut Slot-Layout für einen lokalen Kalendertag (92/96/100 je nach DST). */
export function buildDaySlotLayout(dateKey: string, timezone: string): DaySlotLayout {
	const { startMs, endMs } = localDayBoundsMs(dateKey, timezone);
	const duration = endMs - startMs;
	if (!Number.isFinite(duration) || duration <= 0) {
		return { dateKey, timezone, startMs, endMs, slotCount: 0, slots: [] };
	}
	const slotCount = Math.round(duration / DAY_TELEMETRY_SLOT_MS);
	const slots: DaySlotBoundary[] = [];
	for (let i = 0; i < slotCount; i++) {
		const s = startMs + i * DAY_TELEMETRY_SLOT_MS;
		slots.push({ index: i, startMs: s, endMs: s + DAY_TELEMETRY_SLOT_MS });
	}
	return { dateKey, timezone, startMs, endMs, slotCount, slots };
}

/** Slot-Index für absolute Zeit; null wenn außerhalb des Tages. */
export function slotIndexForMs(layout: DaySlotLayout, ms: number): number | null {
	if (ms < layout.startMs || ms >= layout.endMs) return null;
	const idx = Math.floor((ms - layout.startMs) / DAY_TELEMETRY_SLOT_MS);
	if (idx < 0 || idx >= layout.slotCount) return null;
	return idx;
}

/** Alle Slots, die [fromMs, toMs) überlappen. */
export function overlappingSlotIndices(
	layout: DaySlotLayout,
	fromMs: number,
	toMs: number,
): DaySlotBoundary[] {
	if (!(toMs > fromMs)) return [];
	const out: DaySlotBoundary[] = [];
	for (const s of layout.slots) {
		if (s.endMs <= fromMs || s.startMs >= toMs) continue;
		out.push(s);
	}
	return out;
}

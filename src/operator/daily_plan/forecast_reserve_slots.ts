/**
 * Brücke ForecastPlan-Slots → `ReserveFloorSlot[]` (operator/daily_plan/unified/battery_reserve_floor.ts,
 * next_reliable_pv.ts). Reine Umformung, keine neue Prognoselogik — die eigentliche PV-Recovery-/
 * Netto-Bedarfs-Berechnung bleibt in den bestehenden, unveränderten Funktionen dieser Module.
 */

import type { ForecastPlan } from "../forecast/types";
import type { ReserveFloorSlot } from "./unified/battery_reserve_floor";

export function buildReserveFloorSlotsFromForecastPlan(forecastPlan: ForecastPlan): ReserveFloorSlot[] {
	const slotHours = Math.max(0.01, (forecastPlan.slotMinutes || 15) / 60);
	const out: ReserveFloorSlot[] = [];
	for (const s of forecastPlan.slots) {
		const startMs = Date.parse(s.slot.startIso);
		if (!Number.isFinite(startMs)) continue;
		const pvKwh = Math.max(0, (s.pvPowerW ?? 0) / 1000) * slotHours;
		const houseKwh = Math.max(0, (s.houseLoadPowerW ?? 0) / 1000) * slotHours;
		out.push({
			startIso: s.slot.startIso,
			endIso: s.slot.endIso,
			startMs,
			pvKwh,
			houseKwh,
			importCt: s.gridPriceCtPerKwh,
		});
	}
	return out.sort((a, b) => a.startMs - b.startMs);
}

/** Erster Slot-Index bei/nach `nowMs` — gemeinsamer „von jetzt“-Ankerpunkt für alle Reserve-Funktionen. */
export function findCurrentSlotIdx(slots: ReserveFloorSlot[], nowMs: number): number {
	if (slots.length === 0) return 0;
	const idx = slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMs);
	return idx >= 0 ? idx : Math.max(0, slots.length - 1);
}

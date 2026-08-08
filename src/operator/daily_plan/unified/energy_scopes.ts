/**
 * Zeitliche Energie-Scopes für Unified Planning.
 *
 * Day     = lokaler Kalendertag (EMS-Zeitzone), nicht now+24h
 * Goal    = bis konkreter Deadline (darf Mitternacht überschreiten)
 * Horizon = vollständiger belastbarer Unified-Planungshorizont (~bis 7 Tage)
 */

import { endOfLocalDayIso } from "../slots";
import { isoAtTimezoneLocal, localDateKeyInTimezone } from "../../time";

export type EnergyScopeSlot = {
	slot: { startIso: string; endIso: string };
	energyKwh: number | null | undefined;
};

/** Anteil der Slot-Energie, der im Intervall [rangeStartMs, rangeEndMs) liegt. */
export function energyOverlapKwh(
	startIso: string,
	endIso: string,
	energyKwh: number,
	rangeStartMs: number,
	rangeEndMs: number,
): number {
	if (!Number.isFinite(energyKwh) || energyKwh === 0) return 0;
	const s = Date.parse(startIso);
	const e = Date.parse(endIso);
	if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
	// ±Infinity erlaubt (offene Intervalle); NaN nicht.
	if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs <= rangeStartMs) {
		return 0;
	}
	const overlapStart = Math.max(s, rangeStartMs);
	const overlapEnd = Math.min(e, rangeEndMs);
	if (overlapEnd <= overlapStart) return 0;
	return energyKwh * ((overlapEnd - overlapStart) / (e - s));
}

export function localDayBoundsMs(dateKey: string, timezone: string): {
	startMs: number;
	endMs: number;
} {
	const startMs = Date.parse(isoAtTimezoneLocal(dateKey, 0, 0, timezone));
	const endMs = Date.parse(endOfLocalDayIso(dateKey, timezone));
	return { startMs, endMs };
}

/** Day Scope: Summe der Slot-Energie im lokalen Kalendertag (anteilig an Grenzen). */
export function sumEnergyForLocalDay(
	slots: EnergyScopeSlot[],
	dateKey: string,
	timezone: string,
): number {
	const { startMs, endMs } = localDayBoundsMs(dateKey, timezone);
	let sum = 0;
	for (const s of slots) {
		const e = s.energyKwh;
		if (e === null || e === undefined || !Number.isFinite(e)) continue;
		sum += energyOverlapKwh(s.slot.startIso, s.slot.endIso, e, startMs, endMs);
	}
	return Math.round(sum * 1000) / 1000;
}

/** Goal Scope: Summe bis Deadline (Slot-Start < deadline; anteilig wenn Slot über Deadline geht). */
export function sumEnergyToDeadline(
	slots: EnergyScopeSlot[],
	deadlineIso: string | null | undefined,
): number | null {
	if (!deadlineIso) return null;
	const deadlineMs = Date.parse(deadlineIso);
	if (!Number.isFinite(deadlineMs)) return null;
	let sum = 0;
	for (const s of slots) {
		const e = s.energyKwh;
		if (e === null || e === undefined || !Number.isFinite(e)) continue;
		const slotStart = Date.parse(s.slot.startIso);
		if (!Number.isFinite(slotStart) || slotStart >= deadlineMs) continue;
		sum += energyOverlapKwh(
			s.slot.startIso,
			s.slot.endIso,
			e,
			Number.NEGATIVE_INFINITY,
			deadlineMs,
		);
	}
	return Math.round(sum * 1000) / 1000;
}

/** Horizon Scope: Summe aller gegebenen Slots (z. B. Rest-Horizon nach Trim). */
export function sumEnergyHorizon(slots: EnergyScopeSlot[]): number {
	let sum = 0;
	for (const s of slots) {
		const e = s.energyKwh;
		if (e === null || e === undefined || !Number.isFinite(e)) continue;
		sum += e;
	}
	return Math.round(sum * 1000) / 1000;
}

export function localDateKeyFromIso(iso: string, timezone: string): string {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return iso.slice(0, 10);
	return localDateKeyInTimezone(new Date(ms), timezone);
}

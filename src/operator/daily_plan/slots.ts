import type { OperatorTimeSlot } from "../types";
import {
	OPERATOR_MS_PER_15MIN,
	addDaysToDateKey,
	isoAtTimezoneLocal,
	isoFromMs,
	isValidIsoTimestamp,
} from "../time";

export function floorMinuteTo15(minute: number): number {
	return Math.floor(minute / 15) * 15;
}

export function slotStartIsoFloored(now: Date, timezone: string): string {
	const ms = now.getTime();
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
	const parts = fmt.formatToParts(now);
	const pick = (type: Intl.DateTimeFormatPartTypes): number =>
		parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
	const dateKey = `${pick("year")}-${String(pick("month")).padStart(2, "0")}-${String(pick("day")).padStart(2, "0")}`;
	return isoAtTimezoneLocal(dateKey, pick("hour"), floorMinuteTo15(pick("minute")), timezone);
}

export function endOfLocalDayIso(dateKey: string, timezone: string): string {
	return isoAtTimezoneLocal(addDaysToDateKey(dateKey, 1), 0, 0, timezone);
}

/**
 * Rolling Daily-Plan-Horizont (Roadmap Block 5): mindestens 48 h ab aktuellem 15-Min-Floor.
 * Alle flexiblen Add-ons lesen denselben Plan — kein addon-spezifischer Horizont.
 */
export const DAILY_PLAN_HORIZON_HOURS = 48 as const;

export function buildDailyHorizonSlots(
	now: Date,
	timezone: string,
	slotMinutes = 15,
	horizonHours: number = DAILY_PLAN_HORIZON_HOURS,
): OperatorTimeSlot[] {
	const startIso = slotStartIsoFloored(now, timezone);
	if (!isValidIsoTimestamp(startIso)) return [];

	const hours = Number.isFinite(horizonHours) && horizonHours > 0 ? horizonHours : DAILY_PLAN_HORIZON_HOURS;
	const slotMs = slotMinutes * 60_000;
	let cursor = Date.parse(startIso);
	const endMs = cursor + hours * 3_600_000;
	const out: OperatorTimeSlot[] = [];

	while (cursor < endMs) {
		const next = cursor + slotMs;
		out.push({ startIso: isoFromMs(cursor), endIso: isoFromMs(next) });
		cursor = next;
	}
	return out;
}

export function slotKey(startIso: string, endIso: string): string {
	return `${startIso}|${endIso}`;
}

export function slotDurationHours(slotMinutes: number): number {
	return slotMinutes / 60;
}

export function energyKwhFromPower(powerW: number, slotMinutes: number): number {
	return Math.round((powerW * slotDurationHours(slotMinutes)) / 1000 * 1000) / 1000;
}

export function powerWFromEnergyKwh(energyKwh: number, slotMinutes: number): number {
	const hours = slotDurationHours(slotMinutes);
	if (hours <= 0) return 0;
	return Math.ceil((energyKwh * 1000) / hours);
}

export function slotsUntilDeadline(
	slots: OperatorTimeSlot[],
	deadlineIso: string,
	nowMs: number,
): OperatorTimeSlot[] {
	const deadlineMs = Date.parse(deadlineIso);
	if (!Number.isFinite(deadlineMs)) return slots;
	return slots.filter((s) => {
		const start = Date.parse(s.startIso);
		return Number.isFinite(start) && start >= nowMs && start < deadlineMs;
	});
}

export function minPowerForDeadline(
	remainingEnergyKwh: number,
	slots: OperatorTimeSlot[],
	slotMinutes: number,
	maxPowerW: number | null,
): number | null {
	if (remainingEnergyKwh <= 0) return 0;
	if (slots.length === 0) return null;
	const hours = slots.length * slotDurationHours(slotMinutes);
	if (hours <= 0) return null;
	const needW = Math.ceil((remainingEnergyKwh * 1000) / hours);
	if (maxPowerW !== null) return Math.min(needW, maxPowerW);
	return needW;
}

export const DAILY_PLAN_SLOT_MS = OPERATOR_MS_PER_15MIN;

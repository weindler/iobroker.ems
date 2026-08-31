/**
 * Netzausgleichs-Energie aus EMS-Day-Telemetry rekonstruieren.
 * Keine Schätzung: nur Slots mit gesetztem kWh (inkl. gemessener 0) werden zu Leistungspunkten.
 */

import { DAY_TELEMETRY_CATEGORY, DAY_TELEMETRY_SLOT_MS } from "../day_telemetry/constants";
import { listDayTelemetryDateKeys, readDayTelemetryDay } from "../day_telemetry/persist";
import type { DayTelemetryDayRecord } from "../day_telemetry/types";
import { addDaysToDateKey, localDateKeyInTimezone } from "../../operator/time";
import type { PowerPoint } from "./types";

export type GridBalanceTelemetryResult = {
	points: PowerPoint[];
	/** Tage mit mindestens einem nicht-null GB-Slot — History-Fallback nur wenn 0. */
	observedDayCount: number;
};

export function gridBalanceKwhSlotToPowerW(kwh: number, slotWidthMs: number): number {
	if (!(slotWidthMs > 0) || !Number.isFinite(kwh)) return 0;
	return (kwh * 3_600_000_000) / slotWidthMs;
}

/**
 * Wandelt Slot-kWh in energieerhaltende Leistungspunkte (Slot-Mitte).
 * null-Slots werden ausgelassen (missing), 0 bleibt 0 W.
 */
export function powerPointsFromGridBalanceDay(day: DayTelemetryDayRecord): PowerPoint[] {
	const bucket = day.buckets.gridBalanceDischargeKwh;
	if (!Array.isArray(bucket)) return [];
	const slotMs = day.slotWidthMs > 0 ? day.slotWidthMs : DAY_TELEMETRY_SLOT_MS;
	const points: PowerPoint[] = [];
	for (let i = 0; i < bucket.length; i++) {
		const kwh = bucket[i];
		if (kwh == null || !Number.isFinite(kwh) || kwh < 0) continue;
		const slotStart = day.startMs + i * slotMs;
		points.push({
			ts: slotStart + slotMs / 2,
			powerW: gridBalanceKwhSlotToPowerW(kwh, slotMs),
		});
	}
	return points;
}

export async function loadGridBalancePowerFromDayTelemetry(
	baseDir: string | undefined,
	lookbackDays: number,
	now: Date = new Date(),
	timezone = "Europe/Berlin",
): Promise<GridBalanceTelemetryResult> {
	if (!baseDir || lookbackDays <= 0) {
		return { points: [], observedDayCount: 0 };
	}
	const todayKey = localDateKeyInTimezone(now, timezone);
	const oldestKey = addDaysToDateKey(todayKey, -(lookbackDays - 1));
	let keys: string[];
	try {
		keys = await listDayTelemetryDateKeys(baseDir);
	} catch {
		return { points: [], observedDayCount: 0 };
	}
	const points: PowerPoint[] = [];
	let observedDayCount = 0;
	for (const dateKey of keys) {
		if (dateKey < oldestKey || dateKey > todayKey) continue;
		const day = await readDayTelemetryDay(baseDir, dateKey);
		if (!day) continue;
		const dayPoints = powerPointsFromGridBalanceDay(day);
		if (dayPoints.length > 0) {
			observedDayCount++;
			points.push(...dayPoints);
		}
	}
	points.sort((a, b) => a.ts - b.ts);
	return { points, observedDayCount };
}

export function dayTelemetryDirFromHost(getAbsolutePath?: (category?: string) => string): string | undefined {
	if (!getAbsolutePath) return undefined;
	return getAbsolutePath(DAY_TELEMETRY_CATEGORY);
}

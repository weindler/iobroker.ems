/**
 * Netzausgleichs-Energie aus EMS-Day-Telemetry rekonstruieren.
 * Keine Schätzung: nur Slots mit gesetztem kWh (inkl. gemessener 0) werden zu Leistungspunkten.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
		let kwh = bucket[i];
		if (kwh == null || !Number.isFinite(kwh) || kwh < 0) continue;
		if (day.gridBalanceEnergyKind !== "additional_offset") {
			const house = day.buckets.houseTotalKwh?.[i];
			const pv = day.buckets.pvKwh?.[i];
			if (house == null || pv == null || !Number.isFinite(house) || !Number.isFinite(pv)) continue;
			kwh = Math.max(0, kwh - Math.max(0, house - pv));
		}
		const slotStart = day.startMs + i * slotMs;
		points.push({
			ts: slotStart + slotMs / 2,
			powerW: gridBalanceKwhSlotToPowerW(kwh, slotMs),
		});
	}
	return points;
}

/** Cache-Datei: je abgeschlossenem Tag die fertigen Leistungspunkte (klein), damit nicht jede Stunde alle Tagesdateien geparst werden. */
type GridBalanceDaysCache = { version: 1; days: Record<string, Array<[number, number]>> };

/** Tage jünger als dies (in Tagen) werden immer neu gelesen; ältere sind abgeschlossen und unveränderlich. */
const CACHE_SETTLED_DAYS = 2;

async function readDaysCache(file: string | undefined): Promise<GridBalanceDaysCache> {
	const empty: GridBalanceDaysCache = { version: 1, days: {} };
	if (!file) return empty;
	try {
		const parsed = JSON.parse(await fs.readFile(file, "utf8")) as GridBalanceDaysCache;
		return parsed && parsed.version === 1 && parsed.days && typeof parsed.days === "object" ? parsed : empty;
	} catch {
		return empty;
	}
}

async function writeDaysCache(file: string, cache: GridBalanceDaysCache): Promise<void> {
	try {
		await fs.mkdir(path.dirname(file), { recursive: true });
		const tmp = `${file}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(cache), "utf8");
		await fs.rename(tmp, file);
	} catch {
		/* Cache ist nur Beschleunigung; Fehler dürfen das Lernen nicht stören. */
	}
}

export async function loadGridBalancePowerFromDayTelemetry(
	baseDir: string | undefined,
	lookbackDays: number,
	now: Date = new Date(),
	timezone = "Europe/Berlin",
	cacheFile?: string,
): Promise<GridBalanceTelemetryResult> {
	if (!baseDir || lookbackDays <= 0) {
		return { points: [], observedDayCount: 0 };
	}
	const todayKey = localDateKeyInTimezone(now, timezone);
	const oldestKey = addDaysToDateKey(todayKey, -(lookbackDays - 1));
	const settledBefore = addDaysToDateKey(todayKey, -CACHE_SETTLED_DAYS);
	let keys: string[];
	try {
		keys = await listDayTelemetryDateKeys(baseDir);
	} catch {
		return { points: [], observedDayCount: 0 };
	}
	const cache = await readDaysCache(cacheFile);
	let cacheChanged = false;
	for (const key of Object.keys(cache.days)) {
		if (key < oldestKey) {
			delete cache.days[key];
			cacheChanged = true;
		}
	}
	const points: PowerPoint[] = [];
	let observedDayCount = 0;
	for (const dateKey of keys) {
		if (dateKey < oldestKey || dateKey > todayKey) continue;
		const settled = dateKey < settledBefore;
		const cached = settled ? cache.days[dateKey] : undefined;
		let dayPoints: PowerPoint[];
		if (cached) {
			dayPoints = cached.map(([ts, powerW]) => ({ ts, powerW }));
		} else {
			const day = await readDayTelemetryDay(baseDir, dateKey);
			if (!day) continue;
			dayPoints = powerPointsFromGridBalanceDay(day);
			if (settled) {
				cache.days[dateKey] = dayPoints.map((pt) => [Math.round(pt.ts), Math.round(pt.powerW * 100) / 100]);
				cacheChanged = true;
			}
		}
		if (dayPoints.length > 0) {
			observedDayCount++;
			points.push(...dayPoints);
		}
	}
	if (cacheFile && cacheChanged) await writeDaysCache(cacheFile, cache);
	points.sort((a, b) => a.ts - b.ts);
	return { points, observedDayCount };
}

export function dayTelemetryDirFromHost(getAbsolutePath?: (category?: string) => string): string | undefined {
	if (!getAbsolutePath) return undefined;
	return getAbsolutePath(DAY_TELEMETRY_CATEGORY);
}

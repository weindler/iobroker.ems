/**
 * Verlauf der PV-Stundenprognosen für die Betriebsseite (EMS-Prognose und Brightsky),
 * damit vergangene Stunden im Rückblick (−1/−2 Tage) erhalten bleiben.
 * Reine Anzeige-Daten — keine Planungslogik.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";

export const PV_HOURLY_HISTORY_CATEGORY = "learning/pv_hourly_history";
export const PV_HOURLY_HISTORY_FILE = "pv_hourly_history_v1.json";
export const PV_HISTORY_KEEP_MS = 10 * 24 * 3_600_000;
const HOUR_MS = 3_600_000;

/** Stundenbeginn (ms) -> kWh in dieser Stunde. */
export type HourMap = Record<string, number>;
export interface PvHourlyHistory {
	version: 1;
	/** EMS-Prognose (korrigiert), zuletzt vor Beginn der Stunde gesehen. */
	f: HourMap;
	/** Brightsky-Stundenkurve (Einstrahlung, auf Tagesschätzung skaliert). */
	b: HourMap;
}

export function emptyPvHourlyHistory(): PvHourlyHistory {
	return { version: 1, f: {}, b: {} };
}

export const floorHour = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

function cleanMap(raw: unknown): HourMap {
	const out: HourMap = {};
	if (raw && typeof raw === "object") {
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (/^\d{10,14}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
		}
	}
	return out;
}

export async function readPvHourlyHistory(dir: string): Promise<PvHourlyHistory> {
	try {
		const p = JSON.parse(await fs.readFile(path.join(dir, PV_HOURLY_HISTORY_FILE), "utf8")) as Record<string, unknown>;
		if (p?.version === 1) return { version: 1, f: cleanMap(p.f), b: cleanMap(p.b) };
	} catch {
		/* neu anlegen */
	}
	return emptyPvHourlyHistory();
}

export async function writePvHourlyHistory(dir: string, h: PvHourlyHistory): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	await atomicWriteFile(path.join(dir, PV_HOURLY_HISTORY_FILE), `${JSON.stringify(h)}\n`);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Neue Werte einmischen: Stunden ab der laufenden Stunde werden fortgeschrieben,
 * frühere Stunden bleiben eingefroren. Älteres als 10 Tage wird entfernt.
 */
export function mergePvHistory(
	prev: PvHourlyHistory,
	nowMs: number,
	forecast: Map<number, number>,
	brightsky: Map<number, number>,
): PvHourlyHistory {
	const cur = floorHour(nowMs);
	const cutoff = nowMs - PV_HISTORY_KEEP_MS;
	const next: PvHourlyHistory = { version: 1, f: {}, b: {} };
	for (const [k, v] of Object.entries(prev.f)) if (Number(k) >= cutoff) next.f[k] = v;
	for (const [k, v] of Object.entries(prev.b)) if (Number(k) >= cutoff) next.b[k] = v;
	for (const [t, v] of forecast) if (t >= cur && Number.isFinite(v) && v >= 0) next.f[String(t)] = round3(v);
	for (const [t, v] of brightsky) if (t >= cur && Number.isFinite(v) && v >= 0) next.b[String(t)] = round3(v);
	return next;
}

export interface BrightskyHourPoint {
	startMs: number;
	solar: number;
}

function localDateKey(ms: number, timeZone: string): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Stundenkurve aus Brightsky: Verlauf nach Einstrahlung, Tagessumme = Tagesschätzung.
 * Nur Tage mit lückenloser Abdeckung der Tagesstunden (sonst wäre die Skalierung falsch);
 * für den angebrochenen heutigen Tag bleibt der gespeicherte Verlauf von gestern gültig.
 */
export function brightskyHourlyKwh(
	points: BrightskyHourPoint[],
	dailyKwhByDate: Map<string, number>,
	timeZone: string,
): Map<number, number> {
	const byDay = new Map<string, BrightskyHourPoint[]>();
	for (const p of points) {
		if (!Number.isFinite(p.startMs) || !Number.isFinite(p.solar) || p.solar < 0) continue;
		const k = localDateKey(p.startMs, timeZone);
		const a = byDay.get(k) ?? [];
		a.push(p);
		byDay.set(k, a);
	}
	const out = new Map<number, number>();
	for (const [day, pts] of byDay) {
		const est = dailyKwhByDate.get(day);
		if (est === undefined || !(est > 0)) continue;
		/* Volltag: 24 Stunden (23/25 bei Zeitumstellung) */
		if (pts.length < 23) continue;
		const sum = pts.reduce((s, p) => s + p.solar, 0);
		if (!(sum > 0)) continue;
		for (const p of pts) out.set(floorHour(p.startMs), (p.solar / sum) * est);
	}
	return out;
}

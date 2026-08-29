/**
 * Reine Rechenlogik für den messenden Verbraucherblock.
 * Keine I/O, keine State-IDs — nur Energie-Akkumulation, Zählerreset-Erkennung
 * und Periodensummen. Wiederverwendet den bestehenden Reset-Erkennungsbaustein
 * aus der Statistik (`energyCounterDeltaKwh`) statt eine Parallellogik zu bauen.
 */
import { energyCounterDeltaKwh } from "../../statistics/compute";
import type { MeasuredConsumerSlotPersist } from "./persist";

export function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

export function padSlotIndex(index: number): string {
	return String(index).padStart(2, "0");
}

function addDayDelta(slot: MeasuredConsumerSlotPersist, dateKey: string, deltaKwh: number): void {
	if (!(deltaKwh > 0)) return;
	slot.days[dateKey] = round3((slot.days[dateKey] ?? 0) + deltaKwh);
}

/**
 * Fall A: kumulativer Energiezähler vorhanden.
 * - Erstes Sample: übernimmt initialEnergyKwh als gewünschten EMS-Gesamtstand
 *   (bzw. den Rohzähler direkt, wenn kein Startwert vorgegeben ist).
 * - Danach: nur das Delta zum vorherigen Rohwert wird addiert. Ein Zählerreset
 *   (neuer Rohwert deutlich kleiner) setzt lediglich die Basis neu — der bisherige
 *   EMS-Gesamtstand bleibt unangetastet, kein Phantomverbrauch, kein Rücksprung.
 */
export function applyEnergyStateSample(
	slot: MeasuredConsumerSlotPersist,
	rawKwh: number,
	initialEnergyKwh: number | null,
	dateKey: string,
): void {
	if (!slot.initialized) {
		slot.totalKwh = round3(initialEnergyKwh !== null ? initialEnergyKwh : rawKwh);
		slot.rawEnergyBaselineKwh = rawKwh;
		slot.initialized = true;
		return;
	}
	const d = energyCounterDeltaKwh(slot.rawEnergyBaselineKwh, rawKwh);
	slot.rawEnergyBaselineKwh = d.newBaseline;
	if (d.deltaKwh !== null && d.deltaKwh > 0) {
		slot.totalKwh = round3(slot.totalKwh + d.deltaKwh);
		addDayDelta(slot, dateKey, d.deltaKwh);
	}
}

/**
 * Fall B: kein Energiezähler — Integration aus Leistung × echter Zeitdifferenz.
 * - Erstes Sample: nur Zeitbasis setzen (+ initialEnergyKwh übernehmen), kein Delta.
 * - Lücken über `maxDtSec` (z. B. Adapter-Neustart) werden NICHT nachintegriert.
 */
export function applyPowerIntegrationSample(
	slot: MeasuredConsumerSlotPersist,
	powerW: number,
	nowMs: number,
	initialEnergyKwh: number | null,
	dateKey: string,
	maxDtSec: number,
): void {
	if (!slot.initialized) {
		slot.totalKwh = round3(initialEnergyKwh ?? 0);
		slot.initialized = true;
		slot.lastPowerTsMs = nowMs;
		return;
	}
	if (slot.lastPowerTsMs === null) {
		slot.lastPowerTsMs = nowMs;
		return;
	}
	const dtSec = (nowMs - slot.lastPowerTsMs) / 1000;
	slot.lastPowerTsMs = nowMs;
	if (!(dtSec > 0) || dtSec > maxDtSec) return;
	if (!(powerW >= 0)) return;
	const deltaKwh = (powerW * dtSec) / 3_600_000;
	if (!(deltaKwh > 0)) return;
	slot.totalKwh = round3(slot.totalKwh + deltaKwh);
	addDayDelta(slot, dateKey, deltaKwh);
}

/** Überspringt eine Lücke (ungültiges Sample) ohne Energie zu addieren; verhindert Phantomsprünge danach. */
export function skipPowerIntegrationGap(slot: MeasuredConsumerSlotPersist, nowMs: number): void {
	if (slot.initialized) {
		slot.lastPowerTsMs = nowMs;
	}
}

export function sumDaysForPrefix(days: Record<string, number>, prefix: string): number {
	let sum = 0;
	for (const [k, v] of Object.entries(days)) {
		if (k.startsWith(prefix)) sum += v;
	}
	return round3(sum);
}

export type MeasuredConsumerPeriodTotals = {
	totalKwh: number;
	todayKwh: number;
	yesterdayKwh: number;
	monthKwh: number;
	yearKwh: number;
};

export function resolveSlotPeriods(
	slot: MeasuredConsumerSlotPersist,
	todayKey: string,
	yesterdayKey: string,
): MeasuredConsumerPeriodTotals {
	const monthPrefix = todayKey.slice(0, 7);
	const yearPrefix = todayKey.slice(0, 4);
	return {
		totalKwh: slot.totalKwh,
		todayKwh: slot.days[todayKey] ?? 0,
		yesterdayKwh: slot.days[yesterdayKey] ?? 0,
		monthKwh: sumDaysForPrefix(slot.days, monthPrefix),
		yearKwh: sumDaysForPrefix(slot.days, yearPrefix),
	};
}

/** Entfernt Tages-Einträge älter als `retentionDays` relativ zu `todayDateKey` (kappt Dateiwachstum). */
export function pruneOldDays(
	days: Record<string, number>,
	todayDateKey: string,
	retentionDays: number,
): Record<string, number> {
	const todayMs = Date.parse(`${todayDateKey}T00:00:00Z`);
	if (!Number.isFinite(todayMs)) return days;
	const cutoffMs = todayMs - retentionDays * 86_400_000;
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(days)) {
		const ms = Date.parse(`${k}T00:00:00Z`);
		if (!Number.isFinite(ms) || ms >= cutoffMs) {
			out[k] = v;
		}
	}
	return out;
}

/**
 * Unbekannte Restlast = Hausverbrauch minus Summe der gemessenen (aktiven, gültigen)
 * Verbraucher — niemals negativ, niemals Addition zum Hausverbrauch.
 */
export function computeUnknownHouseLoadW(houseLoadW: number | null, measuredTotalW: number): number | null {
	if (houseLoadW === null || !Number.isFinite(houseLoadW)) return null;
	return Math.max(0, round1(houseLoadW - measuredTotalW));
}

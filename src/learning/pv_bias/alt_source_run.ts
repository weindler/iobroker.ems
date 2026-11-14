import { asNum } from "../../ems_light/state_util";
import { fetchRollupDayKwh } from "../energy_daily_rollup/read";
import type { AltSourceConfig } from "./alt_source";
import {
	dailyRecord,
	readDailyPersist,
	upsertDailyRecord,
	writeDailyPersist,
	type PvBiasDailyPersist,
} from "./daily_persist";
import { freezeInstantMs, localDateKey } from "./dates";
import { readStateNum } from "./history";
import type { SnapshotHost } from "./snapshot";
import type { PvBiasConfig } from "./types";

/** Zweitquelle nur kurz nach der Freeze-Zeit erfassen, sonst wäre der Tageswert nicht mehr vergleichbar. */
export const ALT_CAPTURE_WINDOW_MS = 3 * 3_600_000;

export function shouldCaptureAlt(now: Date, freezeTime: string, alreadyCaptured: boolean): boolean {
	if (alreadyCaptured) return false;
	const freezeMs = freezeInstantMs(freezeTime, now);
	if (freezeMs === null) return false;
	const t = now.getTime();
	return t >= freezeMs && t <= freezeMs + ALT_CAPTURE_WINDOW_MS;
}

/** Liest die Zweitquelle live (heute/morgen). */
export async function readAltLive(
	host: SnapshotHost,
	alt: AltSourceConfig,
): Promise<{ today: number | null; tomorrow: number | null }> {
	return {
		today: await readStateNum(host, alt.todayStateId),
		tomorrow: await readStateNum(host, alt.tomorrowStateId),
	};
}

/** Friert die Zweitquelle für heute einmal ein (neben Hauptforecast + Ist in pv_bias_daily_v1.json). */
export async function runAltSourceCapture(
	host: SnapshotHost,
	cfg: PvBiasConfig,
	alt: AltSourceConfig,
	now = new Date(),
): Promise<boolean> {
	if (typeof host.getAbsolutePath !== "function") return false;
	const dir = host.getAbsolutePath("learning/pv_bias");
	const persist = await readDailyPersist(dir);
	const dateKey = localDateKey(now);
	const existing = dailyRecord(persist, dateKey);
	if (!shouldCaptureAlt(now, cfg.freezeTime, existing?.altForecastKwh != null)) return false;

	const value = asNum((await readAltLive(host, alt)).today);
	if (value === null || !(value > 0)) return false;

	const updated = upsertDailyRecord(persist, {
		date: dateKey,
		actualKwh: existing?.actualKwh ?? null,
		actualCapturedAt: existing?.actualCapturedAt ?? null,
		forecastKwh: existing?.forecastKwh ?? null,
		forecastCapturedAt: existing?.forecastCapturedAt ?? null,
		actualSource: existing?.actualSource,
		forecastSource: existing?.forecastSource,
		altForecastKwh: Math.round(value * 1000) / 1000,
		altCapturedAt: now.toISOString(),
		altSource: alt.todayStateId,
	});
	await writeDailyPersist(dir, updated);
	host.log.debug?.(`PV-Zweitquelle: ${value} kWh für ${dateKey} eingefroren (${alt.todayStateId}).`);
	return true;
}

/**
 * Ergänzt fehlende Ist-Werte vergangener Tage (der 23:58-Snapshot greift bei stündlichem Lernintervall
 * oft nicht) aus dem Energie-Tages-Rollup — dieselbe Quelle wie die Bias-Paarbildung.
 * Nur Kopie für den Vergleich, die Persist-Datei bleibt unverändert.
 */
export async function withRollupActuals(
	host: SnapshotHost,
	persist: PvBiasDailyPersist | null,
	actualStateId: string,
	todayKey: string,
	maxDays = 21,
): Promise<PvBiasDailyPersist | null> {
	if (!persist || !actualStateId) return persist;
	const keys = Object.keys(persist.days).sort().slice(-maxDays);
	const days = { ...persist.days };
	for (const key of keys) {
		const row = days[key];
		if (!row || key >= todayKey || row.actualKwh != null || row.altForecastKwh == null) continue;
		const actual = await fetchRollupDayKwh(host, actualStateId, key);
		if (actual !== null && actual > 0) days[key] = { ...row, actualKwh: actual };
	}
	return { ...persist, days };
}

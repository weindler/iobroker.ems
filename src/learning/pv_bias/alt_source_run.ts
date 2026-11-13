import { asNum } from "../../ems_light/state_util";
import type { AltSourceConfig } from "./alt_source";
import { dailyRecord, readDailyPersist, upsertDailyRecord, writeDailyPersist } from "./daily_persist";
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

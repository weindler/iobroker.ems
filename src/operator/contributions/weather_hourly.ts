/**
 * Stündlicher Temperaturforecast aus vorhandenem BrightSky-Prefix.
 * Keine neue Wetterarchitektur, keine Interpolation, fehlende Stunden bleiben weg.
 */

import { asNum } from "../../ems_light/state_util";
import { correctHorizonTempC } from "../../learning/weather/horizon/math";
import { addDaysToDateKey, localDateKeyInTimezone } from "../time";
import type { WeatherHourlyPoint } from "./weather";

export type WeatherHourlyReadHost = {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

/** Heute + Folgetag (Planner-Horizont), ohne erfundene Stunden. */
export const WEATHER_HOURLY_PROBE_COUNT = 48;

async function readForeignNum(host: WeatherHourlyReadHost, stateId: string): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = await host.getForeignStateAsync?.(stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

async function readForeignStr(host: WeatherHourlyReadHost, stateId: string): Promise<string | null> {
	if (!stateId) return null;
	try {
		const st = await host.getForeignStateAsync?.(stateId);
		if (st?.val == null) return null;
		const s = String(st.val).trim();
		return s || null;
	} catch {
		return null;
	}
}

async function readOwnNum(host: WeatherHourlyReadHost, relId: string): Promise<number | null> {
	try {
		const st = await host.getStateAsync(relId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

function dayIndexFromDateKeys(todayKey: string, hourKey: string): number {
	const t = Date.parse(`${todayKey}T00:00:00Z`);
	const h = Date.parse(`${hourKey}T00:00:00Z`);
	if (!Number.isFinite(t) || !Number.isFinite(h)) return 1;
	return Math.round((h - t) / 86_400_000) + 1;
}

/**
 * Liest BrightSky-artige Stunden (`prefix.NN.timestamp` / `.temperature` / `.cloud_cover`).
 * Ohne timestamp: Stunde wird nicht erzeugt.
 * Temperatur fehlt: outdoorTempC = null (kein Schätzwert).
 * Vorhandener `learning.weather.temp_bias_c` wird wie beim Horizon angewendet.
 */
export async function collectWeatherHourlyPoints(
	host: WeatherHourlyReadHost,
	now: Date,
	timezone: string,
	brightskyHourlyPrefix: string,
): Promise<WeatherHourlyPoint[]> {
	const prefix = brightskyHourlyPrefix.trim();
	if (!prefix) return [];

	const todayKey = localDateKeyInTimezone(now, timezone);
	const tempBiasC = await readOwnNum(host, "learning.weather.temp_bias_c");

	const indices = Array.from({ length: WEATHER_HOURLY_PROBE_COUNT }, (_, i) =>
		String(i).padStart(2, "0"),
	);
	const rows = await Promise.all(
		indices.map(async (idx) => {
			const base = `${prefix}.${idx}`;
			const [timestampRaw, rawTempC, cloudPct] = await Promise.all([
				readForeignStr(host, `${base}.timestamp`),
				readForeignNum(host, `${base}.temperature`),
				readForeignNum(host, `${base}.cloud_cover`),
			]);
			if (!timestampRaw) return null;
			const ms = Date.parse(timestampRaw);
			if (!Number.isFinite(ms)) return null;
			const start = new Date(ms);
			const hourKey = localDateKeyInTimezone(start, timezone);
			const dayIndex = dayIndexFromDateKeys(todayKey, hourKey);
			const outdoorTempC = correctHorizonTempC(rawTempC, tempBiasC, dayIndex);
			const point: WeatherHourlyPoint = {
				startIso: start.toISOString(),
				endIso: new Date(ms + 3_600_000).toISOString(),
				outdoorTempC,
				cloudPct,
			};
			return point;
		}),
	);
	return rows.filter((r): r is WeatherHourlyPoint => r !== null);
}

/** Sichtbar für Tests — reiner dayIndex-Abgleich ohne IO. */
export function weatherHourlyDayIndex(todayKey: string, hourDateKey: string): number {
	return dayIndexFromDateKeys(todayKey, hourDateKey);
}

export function weatherHourlyHorizonEnd(todayKey: string): string {
	return `${addDaysToDateKey(todayKey, 1)}T23:59:59.999Z`;
}

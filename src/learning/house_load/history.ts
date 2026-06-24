import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
	type HistoryQueryHost,
} from "../history_query";
import { MS_PER_HOUR, PLAUSIBLE_W_MAX, PLAUSIBLE_W_MIN } from "./constants";
import { calendarContext } from "./time";
import type { HouseLoadSample } from "./types";

export type HouseLoadHistoryHost = HistoryQueryHost & {
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
};

export type HouseLoadHistoryStats = {
	rowsTotal: number;
	validRows: number;
	hourlySamples: number;
	skippedInvalid: number;
	skippedNegative: number;
};

function hourStartMs(ts: number): number {
	return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte. */
export function isValidHouseLoadW(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	return value >= PLAUSIBLE_W_MIN && value <= PLAUSIBLE_W_MAX;
}

export function detectPowerUnit(stateId: string, unit?: string): "W" | "kW" {
	const u = (unit ?? "").toLowerCase();
	if (u.includes("kw") || u.includes("kilowatt")) {
		return "kW";
	}
	if (u.includes("mw") || u.includes("megawatt")) {
		return "kW";
	}
	if (stateId.toLowerCase().includes("_kw") || stateId.toLowerCase().includes(".kw")) {
		return "kW";
	}
	return "W";
}

export async function resolveHouseLoadPowerUnit(
	host: HouseLoadHistoryHost,
	stateId: string,
): Promise<"W" | "kW"> {
	if (!host.getObjectAsync) {
		return detectPowerUnit(stateId);
	}
	try {
		const obj = await host.getObjectAsync(stateId);
		const unit =
			obj?.common && typeof obj.common === "object"
				? String((obj.common as { unit?: string }).unit ?? "")
				: "";
		return detectPowerUnit(stateId, unit);
	} catch {
		return detectPowerUnit(stateId);
	}
}

/** W/kW → W; fehlende Einheit: Werte < 100 eher kW (z. B. 3.5 statt 3500). */
export function normalizeHouseLoadPowerW(raw: number, unit: "W" | "kW"): number | null {
	if (!Number.isFinite(raw)) {
		return null;
	}
	let watts = raw;
	if (unit === "kW") {
		watts = raw * 1000;
	} else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
		// Sonnen/Alias oft kW numerisch ohne korrekte common.unit
		watts = raw * 1000;
	}
	if (!isValidHouseLoadW(watts)) {
		return null;
	}
	return watts;
}

/** Negative und Ausreißer oberhalb PLAUSIBLE_W_MAX verwerfen. */
export function filterOutliers(values: number[]): number[] {
	if (values.length < 5) {
		return values;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const q1 = sorted[Math.floor(sorted.length * 0.25)];
	const q3 = sorted[Math.floor(sorted.length * 0.75)];
	const iqr = q3 - q1;
	const low = q1 - 1.5 * iqr;
	const high = q3 + 1.5 * iqr;
	return values.filter((v) => v >= low && v <= high);
}

export async function fetchHouseLoadSamples(
	host: HouseLoadHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ samples: HouseLoadSample[]; lastValidTs: number | null; stats: HouseLoadHistoryStats }> {
	const samples: HouseLoadSample[] = [];
	let lastValidTs: number | null = null;
	const stats: HouseLoadHistoryStats = {
		rowsTotal: 0,
		validRows: 0,
		hourlySamples: 0,
		skippedInvalid: 0,
		skippedNegative: 0,
	};

	const powerUnit = await resolveHouseLoadPowerUnit(host, stateId);

	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	stats.rowsTotal = rows.length;

	/** Pro Stunde letzter gültiger Wert — wie battery_runtime/history.ts */
	const byHour = new Map<number, { ts: number; powerW: number }>();
	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const raw = asNum(row?.val);
		if (ts === null || raw === null) {
			stats.skippedInvalid++;
			continue;
		}
		if (raw < 0) {
			stats.skippedNegative++;
			continue;
		}
		const powerW = normalizeHouseLoadPowerW(raw, powerUnit);
		if (powerW === null) {
			stats.skippedInvalid++;
			continue;
		}
		stats.validRows++;
		const bucket = hourStartMs(ts);
		const existing = byHour.get(bucket);
		if (!existing || ts > existing.ts) {
			byHour.set(bucket, { ts, powerW });
		}
		if (lastValidTs === null || ts > lastValidTs) {
			lastValidTs = ts;
		}
	}

	for (const { ts, powerW } of byHour.values()) {
		const d = new Date(ts);
		const ctx = calendarContext(d);
		samples.push({
			ts,
			hourStartMs: hourStartMs(ts),
			dateKey: ctx.dateKey,
			hourOfDay: ctx.hourOfDay,
			segment: ctx.segment,
			season: ctx.season,
			weekday: ctx.weekday,
			dayType: ctx.dayType,
			powerW: Math.round(powerW),
		});
	}

	samples.sort((a, b) => a.hourStartMs - b.hourStartMs);
	stats.hourlySamples = samples.length;
	return { samples, lastValidTs, stats };
}

export function distinctSampleDays(samples: HouseLoadSample[]): number {
	return new Set(samples.map((s) => s.dateKey)).size;
}

/** Tage mit mindestens MIN_DAY_HOURS Stunden-Samples (wie Price validHours). */
export function distinctSampleDaysWithMinHours(
	samples: HouseLoadSample[],
	minHoursPerDay: number,
): number {
	const byDay = new Map<string, number>();
	for (const s of samples) {
		byDay.set(s.dateKey, (byDay.get(s.dateKey) ?? 0) + 1);
	}
	let days = 0;
	for (const count of byDay.values()) {
		if (count >= minHoursPerDay) {
			days++;
		}
	}
	return days;
}

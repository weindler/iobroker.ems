import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsInRange,
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import { fetchRollupPowerHistory } from "../power_rollup";
import {
	MS_PER_HOUR,
	PLAUSIBLE_POWER_W_MAX,
	POWER_DEADBAND_W,
	SOC_MAX,
	SOC_MIN,
} from "./constants";
import { localDateKey } from "./time";
import type { AstroTimePoint, DailyAstroTimes, PowerPoint, SocPoint } from "./types";

export function parseAstroTimeValue(raw: unknown): { hour: number; minute: number } | null {
	if (raw === null || raw === undefined) return null;
	const text = String(raw).trim();
	const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (!m) return null;
	const hour = parseInt(m[1], 10);
	const minute = parseInt(m[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return { hour, minute };
}

export async function fetchAstroTimeHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<AstroTimePoint[]> {
	const points: AstroTimePoint[] = [];
	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const parsed = parseAstroTimeValue(row?.val);
		if (ts === null || !parsed) continue;
		points.push({
			ts,
			dateKey: localDateKey(new Date(ts)),
			hour: parsed.hour,
			minute: parsed.minute,
		});
	}

	points.sort((a, b) => a.ts - b.ts);
	return points;
}

/** Pro Kalendertag die zuletzt geschriebene Astro-Zeit (tägliches JS-Update). */
export function buildDailyAstroTimes(points: AstroTimePoint[]): DailyAstroTimes {
	const startByDate = new Map<string, { hour: number; minute: number }>();
	const endByDate = new Map<string, { hour: number; minute: number }>();
	for (const p of points) {
		startByDate.set(p.dateKey, { hour: p.hour, minute: p.minute });
	}
	return { startByDate, endByDate };
}

export function mergeDailyAstroTimes(
	startPoints: AstroTimePoint[],
	endPoints: AstroTimePoint[],
): DailyAstroTimes {
	const start = buildDailyAstroTimes(startPoints);
	const end = buildDailyAstroTimes(endPoints);
	return { startByDate: start.startByDate, endByDate: end.endByDate };
}

export type BatteryHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getAbsolutePath?: (category?: string) => string;
};

function hourBucket(ts: number): number {
	return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

export function isValidSoc(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) return false;
	return value >= SOC_MIN && value <= SOC_MAX;
}

export function isValidCapacityKwh(value: number | null): value is number {
	if (value === null || !Number.isFinite(value)) return false;
	return value > 0 && value <= 500;
}

/**
 * Nach Normalisierung: positiv = laden, negativ = entladen.
 * @param invert Quell-Vorzeichen umdrehen (z. B. Sonnen pacTotal: + entladen, − laden).
 */
export function normalizeBatteryPowerW(raw: number | null, invert = false): number | null {
	if (raw === null || !Number.isFinite(raw)) return null;
	const signed = invert ? -raw : raw;
	if (Math.abs(signed) > PLAUSIBLE_POWER_W_MAX) return null;
	if (Math.abs(signed) < POWER_DEADBAND_W) return null;
	return Math.round(signed);
}

async function fetchHistoryPoints(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
	parseVal: (raw: unknown) => number | null,
): Promise<{ points: { ts: number; value: number }[]; lastValidTs: number | null }> {
	const byHour = new Map<number, { ts: number; value: number }>();
	let lastValidTs: number | null = null;

	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const value = parseVal(row?.val);
		if (ts === null || value === null) continue;
		const bucket = hourBucket(ts);
		const existing = byHour.get(bucket);
		if (!existing || ts > existing.ts) {
			byHour.set(bucket, { ts, value });
		}
		if (lastValidTs === null || ts > lastValidTs) {
			lastValidTs = ts;
		}
	}

	const points = [...byHour.values()].sort((a, b) => a.ts - b.ts);
	return { points, lastValidTs };
}

export async function fetchSocHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ points: SocPoint[]; lastValidTs: number | null }> {
	const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
		const n = asNum(raw);
		return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
	});
	return {
		points: points.map((p) => ({ ts: p.ts, socPct: p.value })),
		lastValidTs,
	};
}

/** Alle gültigen SOC-Punkte ohne Stunden-Dedup — für Vollladungs-Erkennung (Peaks zwischen Stunden). */
export async function fetchSocHistoryRaw(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<SocPoint[]> {
	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const points: SocPoint[] = [];
	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const n = asNum(row?.val);
		if (ts === null || !isValidSoc(n)) continue;
		points.push({ ts, socPct: Math.round(n * 100) / 100 });
	}
	points.sort((a, b) => a.ts - b.ts);
	return points;
}

export type PowerHistoryMode = "ems_rollup" | "history_fallback";

export type PowerHistoryMeta = {
	rawRows: number;
	normalizedRows: number;
	rawChargeSamples: number;
	rawDischargeSamples: number;
	hourlyChargePoints: number;
	hourlyDischargePoints: number;
	powerInvert: boolean;
	powerInvertAuto: boolean;
	powerHistoryMode: PowerHistoryMode;
};

type HistoryRow = { ts?: number; val?: unknown };

/** Sonnen pacTotal: + entladen dominiert, − laden — Auto-Invert wenn Admin-Checkbox aus. */
export function resolveEffectivePowerInvert(
	configuredInvert: boolean,
	rawRows: HistoryRow[],
): { invert: boolean; autoDetected: boolean } {
	if (configuredInvert) {
		return { invert: true, autoDetected: false };
	}

	let positive = 0;
	let negative = 0;
	for (const row of rawRows) {
		const n = asNum(row?.val);
		if (n === null || Math.abs(n) < POWER_DEADBAND_W || Math.abs(n) > PLAUSIBLE_POWER_W_MAX) {
			continue;
		}
		if (n > 0) positive++;
		else negative++;
	}

	// Typisches Sonnen-Muster: mehr positive Nacht-Entladewerte als negative Lade-Spitzen.
	if (positive >= 3 && negative >= 1 && positive > negative) {
		return { invert: true, autoDetected: true };
	}

	return { invert: false, autoDetected: false };
}

/**
 * Pro Stunde max. Lade- und max. Entladeleistung behalten (nicht nur letzter Wert).
 * Kurze PV-Ladespitzen gehen sonst verloren, wenn die Stunde mit Standby/Entladen endet.
 */
export function aggregatePowerPointsByHour(
	rows: HistoryRow[],
	powerInvert: boolean,
): { points: PowerPoint[]; lastValidTs: number | null; meta: Omit<PowerHistoryMeta, "powerInvert" | "powerInvertAuto" | "powerHistoryMode"> } {
	const byHour = new Map<
		number,
		{ ts: number; maxChargeW: number | null; maxDischargeW: number | null }
	>();
	let normalizedRows = 0;
	let rawChargeSamples = 0;
	let rawDischargeSamples = 0;
	let lastValidTs: number | null = null;

	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const w = normalizeBatteryPowerW(asNum(row?.val), powerInvert);
		if (ts === null || w === null) continue;

		normalizedRows++;
		if (w > 0) rawChargeSamples++;
		else rawDischargeSamples++;

		const bucket = hourBucket(ts);
		const existing = byHour.get(bucket) ?? { ts, maxChargeW: null, maxDischargeW: null };
		if (w > 0) {
			existing.maxChargeW =
				existing.maxChargeW === null ? w : Math.max(existing.maxChargeW, w);
		} else {
			const magnitude = Math.abs(w);
			existing.maxDischargeW =
				existing.maxDischargeW === null ? magnitude : Math.max(existing.maxDischargeW, magnitude);
		}
		if (ts > existing.ts) existing.ts = ts;
		byHour.set(bucket, existing);
		if (lastValidTs === null || ts > lastValidTs) lastValidTs = ts;
	}

	const points: PowerPoint[] = [];
	let hourlyChargePoints = 0;
	let hourlyDischargePoints = 0;
	for (const bucket of byHour.values()) {
		if (bucket.maxChargeW !== null) {
			points.push({ ts: bucket.ts, powerW: bucket.maxChargeW });
			hourlyChargePoints++;
		}
		if (bucket.maxDischargeW !== null) {
			points.push({ ts: bucket.ts, powerW: -bucket.maxDischargeW });
			hourlyDischargePoints++;
		}
	}
	points.sort((a, b) => a.ts - b.ts);

	return {
		points,
		lastValidTs,
		meta: {
			rawRows: rows.length,
			normalizedRows,
			rawChargeSamples,
			rawDischargeSamples,
			hourlyChargePoints,
			hourlyDischargePoints,
		},
	};
}

export async function fetchPowerHistory(
	host: BatteryHistoryHost,
	stateId: string,
	lookbackDays: number,
	powerInvert = false,
): Promise<{ points: PowerPoint[]; lastValidTs: number | null; meta: PowerHistoryMeta }> {
	const rollup = await fetchRollupPowerHistory(host, stateId, lookbackDays);
	if (rollup) {
		return {
			points: rollup.points,
			lastValidTs: rollup.lastValidTs,
			meta: rollup.meta,
		};
	}

	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const { invert, autoDetected } = resolveEffectivePowerInvert(powerInvert, rows);
	const { points, lastValidTs, meta } = aggregatePowerPointsByHour(rows, invert);
	return {
		points,
		lastValidTs,
		meta: {
			...meta,
			powerInvert: invert,
			powerInvertAuto: autoDetected,
			powerHistoryMode: "history_fallback",
		},
	};
}

export async function readLiveCapacityKwh(
	host: BatteryHistoryHost,
	stateId: string,
): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		return isValidCapacityKwh(n) ? Math.round(n * 1000) / 1000 : null;
	} catch {
		return null;
	}
}

export async function readLiveSoc(
	host: BatteryHistoryHost,
	stateId: string,
): Promise<number | null> {
	if (!stateId) return null;
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
	} catch {
		return null;
	}
}

/** Geräte-State: Sekunden seit letzter Vollladung (Sonnen: latestData.secondsSinceFullCharge). */
export async function readSecondsSinceFullCharge(
	host: BatteryHistoryHost,
	stateId: string,
): Promise<number | null> {
	if (!stateId) {
		return null;
	}
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		const n = asNum(st?.val);
		if (n === null || !Number.isFinite(n) || n < 0) {
			return null;
		}
		return Math.round(n);
	} catch {
		return null;
	}
}

export function distinctSocSampleDays(points: SocPoint[]): number {
	return new Set(points.map((p) => new Date(p.ts).toISOString().slice(0, 10))).size;
}

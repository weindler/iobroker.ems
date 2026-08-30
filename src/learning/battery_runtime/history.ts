import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsAggregated,
	fetchHistoryRowsInRange,
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import { fetchRollupPowerHistory, fetchRollupUnidirectionalPowerPoints } from "../power_rollup";
import { detectPowerUnit, resolveHouseLoadPowerUnit } from "../house_load/history";
import {
	MS_PER_DAY,
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
 *
 * Diese Serie ist für Peak-KPIs (maxChargePowerW / maxDischargePowerW) und grobe
 * Entlade-Fenstererkennung — NICHT für kWh-Integration. Peak × Stundenbreite überschätzt
 * die Energie massiv; die Nachtreserve nutzt deshalb ausschließlich SOC-Delta
 * (siehe `computeNightDischarges` in math.ts).
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

function rowsToSitePowerPoints(
	rows: ioBroker.GetHistoryResult,
	powerUnit: "W" | "kW",
): PowerPoint[] {
	const points: PowerPoint[] = [];
	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const n = asNum(row?.val);
		if (ts === null || n === null || !Number.isFinite(n) || n < 0) continue;
		let w = powerUnit === "kW" ? n * 1000 : n;
		/** Auto-kW wenn kleine Rohwerte (wie House-Load / Rollup-Backfill). */
		if (powerUnit === "W" && w > 0 && w < 100) {
			w = n * 1000;
		}
		if (!Number.isFinite(w) || w < 0 || w > PLAUSIBLE_POWER_W_MAX) continue;
		/** 0 W behalten — Nachtbrücke braucht PV=0; Deadband nur für Batterie-Leistung. */
		points.push({ ts, powerW: Math.round(w) });
	}
	points.sort((a, b) => a.ts - b.ts);
	return points;
}

/**
 * Unidirektionale Standort-Leistung (PV oder Hauslast) für Nachtbrücke.
 * 1) EMS-Stunden-Rollup (inkl. 0 W)  2) history.0 Stunden-Mittel  3) Roh-Lookback.
 */
export async function fetchSitePowerSeries(
	host: BatteryHistoryHost & {
		getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	},
	stateId: string,
	lookbackDays: number,
): Promise<PowerPoint[]> {
	if (!stateId) return [];

	const fromRollup = await fetchRollupUnidirectionalPowerPoints(host, stateId, lookbackDays);
	if (fromRollup && fromRollup.points.length > 0) {
		/** Alter Rollup ohne Nacht-0 W → Aggregate bevorzugen (sonst greift pv_house nie). */
		const hasNightish = fromRollup.points.some((p) => p.powerW < 80);
		if (hasNightish) {
			return fromRollup.points;
		}
	}

	const powerUnit = host.getObjectAsync
		? await resolveHouseLoadPowerUnit(host, stateId)
		: detectPowerUnit(stateId);

	const endMs = Date.now();
	const startMs = endMs - lookbackDays * MS_PER_DAY;
	const aggregateRows = await fetchHistoryRowsAggregated(
		host,
		stateId,
		startMs,
		endMs,
		lookbackDays * 24 + 48,
		HISTORY_CHUNK_TIMEOUT_MS,
		"average",
		MS_PER_HOUR,
	);
	const fromAggregate = rowsToSitePowerPoints(aggregateRows, powerUnit);
	if (fromAggregate.length >= Math.min(lookbackDays, 7) * 8) {
		return fromAggregate;
	}

	const rawRows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const fromRaw = rowsToSitePowerPoints(rawRows, powerUnit);
	if (fromRaw.length > fromAggregate.length) {
		return fromRaw;
	}
	if (fromAggregate.length > 0) {
		return fromAggregate;
	}
	/** Letzter Fallback: Tages-only-Rollup besser als leer. */
	return fromRollup?.points ?? [];
}

/** Mindestpunkte für belastbare PV/Haus-Nachtbrücke (≈ 2 Tage à 12 h). */
export const MIN_NIGHT_BRIDGE_SITE_POINTS = 48;

type EnergySample = { ts: number; kwh: number };

/**
 * Tages-/Lebensenergie-Zähler → stündliche Leistung (W).
 * Nachts stagniert der Zähler → ~0 W — genau das braucht die PV/Haus-Brücke,
 * wenn bat_pv_ac keine History hat.
 */
export function energyKwhSeriesToHourlyPowerW(samples: EnergySample[]): PowerPoint[] {
	if (samples.length < 2) return [];
	const sorted = [...samples].sort((a, b) => a.ts - b.ts);
	const byHour = new Map<number, { sumW: number; n: number }>();

	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1]!;
		const cur = sorted[i]!;
		const dKwh = cur.kwh - prev.kwh;
		const dtMs = cur.ts - prev.ts;
		if (!(dtMs > 60_000) || dKwh < -0.001) continue;
		const avgW = Math.min(PLAUSIBLE_POWER_W_MAX, Math.max(0, (dKwh * 3_600_000_000) / dtMs));
		const startBucket = Math.floor(prev.ts / MS_PER_HOUR) * MS_PER_HOUR;
		const endBucket = Math.floor(cur.ts / MS_PER_HOUR) * MS_PER_HOUR;
		for (let b = startBucket; b <= endBucket; b += MS_PER_HOUR) {
			const curBucket = byHour.get(b) ?? { sumW: 0, n: 0 };
			curBucket.sumW += avgW;
			curBucket.n += 1;
			byHour.set(b, curBucket);
		}
	}

	return [...byHour.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([b, v]) => ({
			ts: b + MS_PER_HOUR / 2,
			powerW: Math.round(v.sumW / Math.max(1, v.n)),
		}));
}

function detectEnergyUnitIsWh(values: number[]): boolean {
	const positive = values.filter((v) => v > 0);
	if (positive.length < 4) return false;
	const sorted = [...positive].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)]!;
	/** Typische Tageszähler < 200 kWh; Wh-Zähler oft Tausende. */
	return median >= 500;
}

/**
 * PV-Leistung aus Energiezähler-Historie (PV-Bias Ist-State), wenn PV-AC-History fehlt.
 */
export async function fetchSitePowerFromEnergyCounter(
	host: BatteryHistoryHost & {
		getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	},
	energyStateId: string,
	lookbackDays: number,
): Promise<PowerPoint[]> {
	if (!energyStateId || lookbackDays <= 0) return [];

	const rows = await fetchHistoryRowsLookback(
		host,
		energyStateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);
	const rawVals: number[] = [];
	for (const row of rows) {
		const n = asNum(row?.val);
		if (n !== null && Number.isFinite(n) && n >= 0) rawVals.push(n);
	}
	const asWh = detectEnergyUnitIsWh(rawVals);
	const samples: EnergySample[] = [];
	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const n = asNum(row?.val);
		if (ts === null || n === null || !Number.isFinite(n) || n < 0) continue;
		samples.push({ ts, kwh: asWh ? n / 1000 : n });
	}
	return energyKwhSeriesToHourlyPowerW(samples);
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

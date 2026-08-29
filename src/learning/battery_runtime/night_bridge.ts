/**
 * PV-/Hauslast-Nachtbrücke: Abend = PV reicht nicht mehr (Batterie hilft),
 * Morgen = PV deckt wieder (Batterie muss nicht mehr helfen).
 * Feste Uhrzeiten nur Fallback — Winter/Sommer verschieben die Brücke um Stunden.
 */

import { MS_PER_HOUR, POWER_DEADBAND_W } from "./constants";
import { localDateKey } from "./time";
import type { PowerPoint, SocPoint } from "./types";

export const DEFAULT_NIGHT_BRIDGE_FLUTTER_MS = 10 * 60_000;
export const NIGHT_BRIDGE_BUCKET_MS = 10 * 60_000;
/** Netto-Defizit Haus−PV über diesem Wert → Batterie muss helfen. */
export const NIGHT_BRIDGE_DEFICIT_W = Math.max(100, POWER_DEADBAND_W);

export type NightBridgeWindow = {
	startTs: number;
	endTs: number;
	/** Abend-Tag (lokales Datum des Brückenstarts). */
	eveningDateKey: string;
	method: "pv_house" | "battery_discharge" | "astro" | "fixed_clock";
};

export type NightBridgeSeriesPoint = {
	ts: number;
	/** Positiv = PV deckt Haus; negativ = Defizit (Batterie/Netz helfen). */
	netW: number;
};

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Rohserie → 10-Min-Buckets (Mittel). */
export function bucketPowerSeries(
	points: PowerPoint[],
	bucketMs = NIGHT_BRIDGE_BUCKET_MS,
): PowerPoint[] {
	if (points.length === 0) return [];
	const byBucket = new Map<number, { sum: number; n: number; ts: number }>();
	for (const p of points) {
		if (!Number.isFinite(p.ts) || !Number.isFinite(p.powerW)) continue;
		const b = Math.floor(p.ts / bucketMs) * bucketMs;
		const cur = byBucket.get(b) ?? { sum: 0, n: 0, ts: b + bucketMs / 2 };
		cur.sum += p.powerW;
		cur.n += 1;
		byBucket.set(b, cur);
	}
	return [...byBucket.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, v]) => ({ ts: v.ts, powerW: v.sum / v.n }));
}

/**
 * Netto = PV − Hauslast. Negativ = Defizit (Batterie hilft).
 * Hauslast führt das Raster (dicht); PV per Bucket / Nachbar / Last-Known (onchange hält Wert).
 * Kein Fake-0 ohne gemessenen PV-Wert — nur Weiterreichen des letzten bekannten PV.
 */
export function buildPvHouseNetSeries(
	pvPoints: PowerPoint[],
	housePoints: PowerPoint[],
	bucketMs = NIGHT_BRIDGE_BUCKET_MS,
): NightBridgeSeriesPoint[] {
	const effectiveBucket = inferBucketMs(pvPoints, housePoints, bucketMs);
	const pv = bucketPowerSeries(pvPoints, effectiveBucket);
	const house = bucketPowerSeries(housePoints, effectiveBucket);
	if (pv.length === 0 || house.length === 0) return [];

	const pvByBucket = new Map<number, number>();
	for (const p of pv) {
		pvByBucket.set(Math.floor(p.ts / effectiveBucket) * effectiveBucket, p.powerW);
	}

	const pvSorted = [...pv].sort((a, b) => a.ts - b.ts);
	let pvIdx = 0;
	let lastPv: number | null = null;
	const out: NightBridgeSeriesPoint[] = [];

	for (const h of [...house].sort((a, b) => a.ts - b.ts)) {
		const b = Math.floor(h.ts / effectiveBucket) * effectiveBucket;
		while (pvIdx < pvSorted.length && pvSorted[pvIdx]!.ts <= h.ts + effectiveBucket / 2) {
			lastPv = pvSorted[pvIdx]!.powerW;
			pvIdx += 1;
		}
		let pw = pvByBucket.get(b);
		if (pw === undefined) {
			pw = pvByBucket.get(b - effectiveBucket) ?? pvByBucket.get(b + effectiveBucket);
		}
		if (pw === undefined) {
			/** onchange: letzter bekannter PV-Wert (auch 0 W nach Sonnenuntergang). */
			if (lastPv === null) continue;
			pw = lastPv;
		}
		out.push({ ts: h.ts, netW: pw - h.powerW });
	}
	return out;
}

function inferBucketMs(a: PowerPoint[], b: PowerPoint[], preferred: number): number {
	const pts = [...a, ...b].sort((x, y) => x.ts - y.ts);
	if (pts.length < 4) return preferred;
	const gaps: number[] = [];
	for (let i = 1; i < Math.min(pts.length, 80); i++) {
		const g = pts[i]!.ts - pts[i - 1]!.ts;
		if (g > 60_000) gaps.push(g);
	}
	if (gaps.length === 0) return preferred;
	gaps.sort((x, y) => x - y);
	const median = gaps[Math.floor(gaps.length / 2)]!;
	/** Stunden-Rollup → 1‑h-Buckets, Flattern = 1 Stunde. */
	if (median >= 40 * 60_000) return MS_PER_HOUR;
	return preferred;
}

/** Batterie-Leistung: negativ = Entladen → Defizit-Proxy. */
export function buildBatteryDeficitSeries(
	batteryPoints: PowerPoint[],
	bucketMs = NIGHT_BRIDGE_BUCKET_MS,
): NightBridgeSeriesPoint[] {
	return bucketPowerSeries(batteryPoints, bucketMs).map((p) => ({
		ts: p.ts,
		/** Entladen (−W) → negatives net (Defizit). Laden → positiv. */
		netW: p.powerW,
	}));
}

function localHourFromTs(ts: number): number {
	return new Date(ts).getHours();
}

/**
 * Erste stabile Defizit-Phase (netW ≤ −deficitW) ab searchFromTs, Länge ≥ flutterMs.
 * Rückgabe = Beginn der bestätigten Phase (nicht erst nach Flattern).
 */
export function findSustainedDeficitStart(
	series: NightBridgeSeriesPoint[],
	searchFromTs: number,
	searchToTs: number,
	opts: { flutterMs: number; deficitW: number; bucketMs: number },
): number | null {
	const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
	let run = 0;
	let runStart: number | null = null;
	for (const p of series) {
		if (p.ts < searchFromTs || p.ts > searchToTs) continue;
		const deficit = p.netW <= -opts.deficitW;
		if (deficit) {
			if (run === 0) runStart = p.ts;
			run += 1;
			if (run >= need && runStart !== null) return runStart;
		} else {
			run = 0;
			runStart = null;
		}
	}
	return null;
}

/**
 * Erste stabile Surplus-Phase (netW ≥ +deficitW) ab searchFromTs.
 */
export function findSustainedSurplusStart(
	series: NightBridgeSeriesPoint[],
	searchFromTs: number,
	searchToTs: number,
	opts: { flutterMs: number; deficitW: number; bucketMs: number },
): number | null {
	const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
	let run = 0;
	let runStart: number | null = null;
	for (const p of series) {
		if (p.ts < searchFromTs || p.ts > searchToTs) continue;
		const surplus = p.netW >= opts.deficitW;
		if (surplus) {
			if (run === 0) runStart = p.ts;
			run += 1;
			if (run >= need && runStart !== null) return runStart;
		} else {
			run = 0;
			runStart = null;
		}
	}
	return null;
}

/**
 * Erste stabile Phase ohne Defizit (netW > −deficitW) — Batterie-Fallback morgens
 * (PV-Haus nutzt Surplus; Batterie oft nur „nicht mehr entladen“).
 */
export function findSustainedNonDeficitStart(
	series: NightBridgeSeriesPoint[],
	searchFromTs: number,
	searchToTs: number,
	opts: { flutterMs: number; deficitW: number; bucketMs: number },
): number | null {
	const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
	let run = 0;
	let runStart: number | null = null;
	for (const p of series) {
		if (p.ts < searchFromTs || p.ts > searchToTs) continue;
		const ok = p.netW > -opts.deficitW;
		if (ok) {
			if (run === 0) runStart = p.ts;
			run += 1;
			if (run >= need && runStart !== null) return runStart;
		} else {
			run = 0;
			runStart = null;
		}
	}
	return null;
}

/**
 * Pro Abend-Tag eine Brücke: nach lokalem Mittag Defizit → bis Surplus am Folgemorgen.
 * Flattern ist in der Erkennung eingerechnet (mind. flutterMs stabil).
 */
export function findPvHouseNightBridges(
	series: NightBridgeSeriesPoint[],
	opts?: {
		flutterMs?: number;
		deficitW?: number;
		bucketMs?: number;
		method?: NightBridgeWindow["method"];
	},
): NightBridgeWindow[] {
	if (series.length < 4) return [];
	const flutterMs = opts?.flutterMs ?? DEFAULT_NIGHT_BRIDGE_FLUTTER_MS;
	const deficitW = opts?.deficitW ?? NIGHT_BRIDGE_DEFICIT_W;
	const bucketMs = opts?.bucketMs ?? NIGHT_BRIDGE_BUCKET_MS;
	const method = opts?.method ?? "pv_house";
	const gate = { flutterMs, deficitW, bucketMs };

	const dateKeys = [...new Set(series.map((p) => localDateKey(new Date(p.ts))))].sort();
	const out: NightBridgeWindow[] = [];

	for (let i = 0; i < dateKeys.length - 1; i++) {
		const eveningKey = dateKeys[i]!;
		const morningKey = dateKeys[i + 1]!;
		const dayPoints = series.filter((p) => localDateKey(new Date(p.ts)) === eveningKey);
		const noonTs = dayPoints.find((p) => localHourFromTs(p.ts) >= 12)?.ts;
		if (noonTs === undefined) continue;

		const nextNoon =
			series.find(
				(p) => localDateKey(new Date(p.ts)) === morningKey && localHourFromTs(p.ts) >= 12,
			)?.ts ?? noonTs + 24 * MS_PER_HOUR;

		const startTs = findSustainedDeficitStart(series, noonTs, nextNoon, gate);
		if (startTs === null) continue;

		const endTsSurplus = findSustainedSurplusStart(series, startTs + flutterMs, nextNoon, gate);
		const endTs =
			endTsSurplus ??
			(method === "battery_discharge"
				? findSustainedNonDeficitStart(series, startTs + flutterMs, nextNoon, gate)
				: null);
		if (endTs === null || endTs <= startTs) continue;
		/** Mindestens ~4 h Brücke, höchstens 20 h (Plausibilität). */
		const durH = (endTs - startTs) / MS_PER_HOUR;
		if (durH < 4 || durH > 20) continue;

		out.push({
			startTs,
			endTs,
			eveningDateKey: eveningKey,
			method,
		});
	}
	return out;
}

export function findNearestSoc(points: SocPoint[], targetTs: number, maxDeltaMs: number): number | null {
	let best: SocPoint | null = null;
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const p of points) {
		const d = Math.abs(p.ts - targetTs);
		if (d < bestDelta) {
			bestDelta = d;
			best = p;
		}
	}
	if (!best || bestDelta > maxDeltaMs) return null;
	return best.socPct;
}

/** Letzter SOC ≤ targetTs (innerhalb maxDelta) — Abend-Start ohne schon entladenen Nachbarpunkt. */
export function findSocAtOrBefore(
	points: SocPoint[],
	targetTs: number,
	maxDeltaMs: number,
): number | null {
	let best: SocPoint | null = null;
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const p of points) {
		if (p.ts > targetTs) continue;
		const d = targetTs - p.ts;
		if (d <= maxDeltaMs && d < bestDelta) {
			bestDelta = d;
			best = p;
		}
	}
	return best ? best.socPct : null;
}

/**
 * Tiefster SOC im Brückenfenster — verhindert Unterschätzung, wenn das Fensterende
 * schon in die Morgenladung fällt und „nächster SOC“ wieder höher ist.
 */
export function findMinSocInRange(
	points: SocPoint[],
	startTs: number,
	endTs: number,
): number | null {
	if (!(endTs > startTs) || points.length === 0) return null;
	let min: number | null = null;
	for (const p of points) {
		if (p.ts < startTs || p.ts > endTs) continue;
		if (min === null || p.socPct < min) min = p.socPct;
	}
	return min;
}

/**
 * Gewichtetes Mittel: jüngere Nächte stärker (Halbwertszeit ~10 Tage).
 * Sonst bleibt der Sommer-Schnitt bei längeren Herbst-/Winternächten hängen.
 */
export function recencyWeight(ageDays: number, halfLifeDays = 10): number {
	if (!(ageDays >= 0) || !Number.isFinite(ageDays)) return 0;
	return Math.exp((-Math.LN2 * ageDays) / Math.max(1, halfLifeDays));
}

export function weightedAverage(values: number[], weights: number[]): number | null {
	if (values.length === 0 || values.length !== weights.length) return null;
	let sw = 0;
	let sx = 0;
	for (let i = 0; i < values.length; i++) {
		const w = weights[i]!;
		if (!(w > 0)) continue;
		sw += w;
		sx += values[i]! * w;
	}
	if (!(sw > 0)) return null;
	return round2(sx / sw);
}

/**
 * Integriert eine Leistungsserie (W) über [startTs, endTs] zu kWh. Jeder Punkt repräsentiert
 * den Zeitraum bis zur Mitte zum Nachbarn (funktioniert für dichte 10-Min- wie für sparsame
 * Stunden-Serien, ohne festen Bucket anzunehmen). Damit wird Hausverbrauch über exakt dasselbe
 * (dynamisch erkannte) Fenster integriert, das auch die Batterie-Entladung bewertet — kein
 * zweites, unabhängiges Zeitfenster oder eine zweite Annahme über die Abtastrate.
 */
export function integratePowerKwh(
	points: PowerPoint[],
	startTs: number,
	endTs: number,
): number | null {
	if (!(endTs > startTs) || points.length === 0) return null;
	const sorted = points
		.filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.powerW))
		.sort((a, b) => a.ts - b.ts);
	if (sorted.length === 0) return null;

	let kwh = 0;
	let coveredMs = 0;
	for (let i = 0; i < sorted.length; i++) {
		const cur = sorted[i]!;
		if (cur.ts < startTs - MS_PER_HOUR || cur.ts > endTs + MS_PER_HOUR) continue;
		const prevTs = i > 0 ? sorted[i - 1]!.ts : cur.ts;
		const nextTs = i < sorted.length - 1 ? sorted[i + 1]!.ts : cur.ts;
		const segStart = Math.max(startTs, cur.ts - (cur.ts - prevTs) / 2);
		const segEnd = Math.min(endTs, cur.ts + (nextTs - cur.ts) / 2);
		const segMs = segEnd - segStart;
		if (segMs <= 0) continue;
		kwh += (cur.powerW * segMs) / 3_600_000_000;
		coveredMs += segMs;
	}
	/** Zu lückenhafte Abdeckung (< 50 % des Fensters) → kein belastbarer Wert. */
	if (coveredMs < (endTs - startTs) * 0.5) return null;
	return round2(kwh);
}

export { average };

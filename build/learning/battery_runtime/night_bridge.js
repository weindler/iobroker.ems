"use strict";
/**
 * PV-/Hauslast-Nachtbrücke: Abend = PV reicht nicht mehr (Batterie hilft),
 * Morgen = PV deckt wieder (Batterie muss nicht mehr helfen).
 * Feste Uhrzeiten nur Fallback — Winter/Sommer verschieben die Brücke um Stunden.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.average = exports.integrateDischargeKwh = exports.integratePowerKwh = exports.weightedAverage = exports.recencyWeight = exports.findMinSocInRange = exports.findSocAtOrBefore = exports.findNearestSoc = exports.findPvHouseNightBridges = exports.findSustainedNonDeficitStart = exports.findSustainedSurplusStart = exports.findSustainedDeficitStart = exports.buildBatteryDeficitSeries = exports.buildPvHouseNetSeries = exports.bucketPowerSeries = exports.NIGHT_BRIDGE_DEFICIT_W = exports.NIGHT_BRIDGE_BUCKET_MS = exports.DEFAULT_NIGHT_BRIDGE_FLUTTER_MS = void 0;
const constants_1 = require("./constants");
const time_1 = require("./time");
exports.DEFAULT_NIGHT_BRIDGE_FLUTTER_MS = 10 * 60_000;
exports.NIGHT_BRIDGE_BUCKET_MS = 10 * 60_000;
/** Netto-Defizit Haus−PV über diesem Wert → Batterie muss helfen. */
exports.NIGHT_BRIDGE_DEFICIT_W = Math.max(100, constants_1.POWER_DEADBAND_W);
function round2(n) {
    return Math.round(n * 100) / 100;
}
function average(values) {
    if (values.length === 0)
        return null;
    return round2(values.reduce((a, b) => a + b, 0) / values.length);
}
exports.average = average;
/** Rohserie → 10-Min-Buckets (Mittel). */
function bucketPowerSeries(points, bucketMs = exports.NIGHT_BRIDGE_BUCKET_MS) {
    if (points.length === 0)
        return [];
    const byBucket = new Map();
    for (const p of points) {
        if (!Number.isFinite(p.ts) || !Number.isFinite(p.powerW))
            continue;
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
exports.bucketPowerSeries = bucketPowerSeries;
/**
 * Netto = PV − Hauslast. Negativ = Defizit (Batterie hilft).
 * Hauslast führt das Raster (dicht); PV per Bucket / Nachbar / Last-Known (onchange hält Wert).
 * Kein Fake-0 ohne gemessenen PV-Wert — nur Weiterreichen des letzten bekannten PV.
 */
function buildPvHouseNetSeries(pvPoints, housePoints, bucketMs = exports.NIGHT_BRIDGE_BUCKET_MS) {
    const effectiveBucket = inferBucketMs(pvPoints, housePoints, bucketMs);
    const pv = bucketPowerSeries(pvPoints, effectiveBucket);
    const house = bucketPowerSeries(housePoints, effectiveBucket);
    if (pv.length === 0 || house.length === 0)
        return [];
    const pvByBucket = new Map();
    for (const p of pv) {
        pvByBucket.set(Math.floor(p.ts / effectiveBucket) * effectiveBucket, p.powerW);
    }
    const pvSorted = [...pv].sort((a, b) => a.ts - b.ts);
    let pvIdx = 0;
    let lastPv = null;
    const out = [];
    for (const h of [...house].sort((a, b) => a.ts - b.ts)) {
        const b = Math.floor(h.ts / effectiveBucket) * effectiveBucket;
        while (pvIdx < pvSorted.length && pvSorted[pvIdx].ts <= h.ts + effectiveBucket / 2) {
            lastPv = pvSorted[pvIdx].powerW;
            pvIdx += 1;
        }
        let pw = pvByBucket.get(b);
        if (pw === undefined) {
            pw = pvByBucket.get(b - effectiveBucket) ?? pvByBucket.get(b + effectiveBucket);
        }
        if (pw === undefined) {
            /** onchange: letzter bekannter PV-Wert (auch 0 W nach Sonnenuntergang). */
            if (lastPv === null)
                continue;
            pw = lastPv;
        }
        out.push({ ts: h.ts, netW: pw - h.powerW });
    }
    return out;
}
exports.buildPvHouseNetSeries = buildPvHouseNetSeries;
function inferBucketMs(a, b, preferred) {
    const pts = [...a, ...b].sort((x, y) => x.ts - y.ts);
    if (pts.length < 4)
        return preferred;
    const gaps = [];
    for (let i = 1; i < Math.min(pts.length, 80); i++) {
        const g = pts[i].ts - pts[i - 1].ts;
        if (g > 60_000)
            gaps.push(g);
    }
    if (gaps.length === 0)
        return preferred;
    gaps.sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)];
    /** Stunden-Rollup → 1‑h-Buckets, Flattern = 1 Stunde. */
    if (median >= 40 * 60_000)
        return constants_1.MS_PER_HOUR;
    return preferred;
}
/** Batterie-Leistung: negativ = Entladen → Defizit-Proxy. */
function buildBatteryDeficitSeries(batteryPoints, bucketMs = exports.NIGHT_BRIDGE_BUCKET_MS) {
    return bucketPowerSeries(batteryPoints, bucketMs).map((p) => ({
        ts: p.ts,
        /** Entladen (−W) → negatives net (Defizit). Laden → positiv. */
        netW: p.powerW,
    }));
}
exports.buildBatteryDeficitSeries = buildBatteryDeficitSeries;
function localHourFromTs(ts) {
    return new Date(ts).getHours();
}
/**
 * Erste stabile Defizit-Phase (netW ≤ −deficitW) ab searchFromTs, Länge ≥ flutterMs.
 * Rückgabe = Beginn der bestätigten Phase (nicht erst nach Flattern).
 */
function findSustainedDeficitStart(series, searchFromTs, searchToTs, opts) {
    const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
    let run = 0;
    let runStart = null;
    for (const p of series) {
        if (p.ts < searchFromTs || p.ts > searchToTs)
            continue;
        const deficit = p.netW <= -opts.deficitW;
        if (deficit) {
            if (run === 0)
                runStart = p.ts;
            run += 1;
            if (run >= need && runStart !== null)
                return runStart;
        }
        else {
            run = 0;
            runStart = null;
        }
    }
    return null;
}
exports.findSustainedDeficitStart = findSustainedDeficitStart;
/**
 * Erste stabile Surplus-Phase (netW ≥ +deficitW) ab searchFromTs.
 */
function findSustainedSurplusStart(series, searchFromTs, searchToTs, opts) {
    const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
    let run = 0;
    let runStart = null;
    for (const p of series) {
        if (p.ts < searchFromTs || p.ts > searchToTs)
            continue;
        const surplus = p.netW >= opts.deficitW;
        if (surplus) {
            if (run === 0)
                runStart = p.ts;
            run += 1;
            if (run >= need && runStart !== null)
                return runStart;
        }
        else {
            run = 0;
            runStart = null;
        }
    }
    return null;
}
exports.findSustainedSurplusStart = findSustainedSurplusStart;
/**
 * Erste stabile Phase ohne Defizit (netW > −deficitW) — Batterie-Fallback morgens
 * (PV-Haus nutzt Surplus; Batterie oft nur „nicht mehr entladen“).
 */
function findSustainedNonDeficitStart(series, searchFromTs, searchToTs, opts) {
    const need = Math.max(1, Math.ceil(opts.flutterMs / opts.bucketMs));
    let run = 0;
    let runStart = null;
    for (const p of series) {
        if (p.ts < searchFromTs || p.ts > searchToTs)
            continue;
        const ok = p.netW > -opts.deficitW;
        if (ok) {
            if (run === 0)
                runStart = p.ts;
            run += 1;
            if (run >= need && runStart !== null)
                return runStart;
        }
        else {
            run = 0;
            runStart = null;
        }
    }
    return null;
}
exports.findSustainedNonDeficitStart = findSustainedNonDeficitStart;
/**
 * Pro Abend-Tag eine Brücke: nach lokalem Mittag Defizit → bis Surplus am Folgemorgen.
 * Flattern ist in der Erkennung eingerechnet (mind. flutterMs stabil).
 */
function findPvHouseNightBridges(series, opts) {
    if (series.length < 4)
        return [];
    const flutterMs = opts?.flutterMs ?? exports.DEFAULT_NIGHT_BRIDGE_FLUTTER_MS;
    const deficitW = opts?.deficitW ?? exports.NIGHT_BRIDGE_DEFICIT_W;
    const bucketMs = opts?.bucketMs ?? exports.NIGHT_BRIDGE_BUCKET_MS;
    const method = opts?.method ?? "pv_house";
    const gate = { flutterMs, deficitW, bucketMs };
    const dateKeys = [...new Set(series.map((p) => (0, time_1.localDateKey)(new Date(p.ts))))].sort();
    const out = [];
    for (let i = 0; i < dateKeys.length - 1; i++) {
        const eveningKey = dateKeys[i];
        const morningKey = dateKeys[i + 1];
        const dayPoints = series.filter((p) => (0, time_1.localDateKey)(new Date(p.ts)) === eveningKey);
        const noonTs = dayPoints.find((p) => localHourFromTs(p.ts) >= 12)?.ts;
        if (noonTs === undefined)
            continue;
        const nextNoon = series.find((p) => (0, time_1.localDateKey)(new Date(p.ts)) === morningKey && localHourFromTs(p.ts) >= 12)?.ts ?? noonTs + 24 * constants_1.MS_PER_HOUR;
        const startTs = findSustainedDeficitStart(series, noonTs, nextNoon, gate);
        if (startTs === null)
            continue;
        const endTsSurplus = findSustainedSurplusStart(series, startTs + flutterMs, nextNoon, gate);
        const endTs = endTsSurplus ??
            (method === "battery_discharge"
                ? findSustainedNonDeficitStart(series, startTs + flutterMs, nextNoon, gate)
                : null);
        if (endTs === null || endTs <= startTs)
            continue;
        /** Mindestens ~4 h Brücke, höchstens 20 h (Plausibilität). */
        const durH = (endTs - startTs) / constants_1.MS_PER_HOUR;
        if (durH < 4 || durH > 20)
            continue;
        out.push({
            startTs,
            endTs,
            eveningDateKey: eveningKey,
            method,
        });
    }
    return out;
}
exports.findPvHouseNightBridges = findPvHouseNightBridges;
function findNearestSoc(points, targetTs, maxDeltaMs) {
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const p of points) {
        const d = Math.abs(p.ts - targetTs);
        if (d < bestDelta) {
            bestDelta = d;
            best = p;
        }
    }
    if (!best || bestDelta > maxDeltaMs)
        return null;
    return best.socPct;
}
exports.findNearestSoc = findNearestSoc;
/** Letzter SOC ≤ targetTs (innerhalb maxDelta) — Abend-Start ohne schon entladenen Nachbarpunkt. */
function findSocAtOrBefore(points, targetTs, maxDeltaMs) {
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const p of points) {
        if (p.ts > targetTs)
            continue;
        const d = targetTs - p.ts;
        if (d <= maxDeltaMs && d < bestDelta) {
            bestDelta = d;
            best = p;
        }
    }
    return best ? best.socPct : null;
}
exports.findSocAtOrBefore = findSocAtOrBefore;
/**
 * Tiefster SOC im Brückenfenster — verhindert Unterschätzung, wenn das Fensterende
 * schon in die Morgenladung fällt und „nächster SOC“ wieder höher ist.
 */
function findMinSocInRange(points, startTs, endTs) {
    if (!(endTs > startTs) || points.length === 0)
        return null;
    let min = null;
    for (const p of points) {
        if (p.ts < startTs || p.ts > endTs)
            continue;
        if (min === null || p.socPct < min)
            min = p.socPct;
    }
    return min;
}
exports.findMinSocInRange = findMinSocInRange;
/**
 * Gewichtetes Mittel: jüngere Nächte stärker (Halbwertszeit ~10 Tage).
 * Sonst bleibt der Sommer-Schnitt bei längeren Herbst-/Winternächten hängen.
 */
function recencyWeight(ageDays, halfLifeDays = 10) {
    if (!(ageDays >= 0) || !Number.isFinite(ageDays))
        return 0;
    return Math.exp((-Math.LN2 * ageDays) / Math.max(1, halfLifeDays));
}
exports.recencyWeight = recencyWeight;
function weightedAverage(values, weights) {
    if (values.length === 0 || values.length !== weights.length)
        return null;
    let sw = 0;
    let sx = 0;
    for (let i = 0; i < values.length; i++) {
        const w = weights[i];
        if (!(w > 0))
            continue;
        sw += w;
        sx += values[i] * w;
    }
    if (!(sw > 0))
        return null;
    return round2(sx / sw);
}
exports.weightedAverage = weightedAverage;
/**
 * Integriert eine Leistungsserie (W) über [startTs, endTs] zu kWh. Jeder Punkt repräsentiert
 * den Zeitraum bis zur Mitte zum Nachbarn (funktioniert für dichte 10-Min- wie für sparsame
 * Stunden-Serien, ohne festen Bucket anzunehmen). Damit wird Hausverbrauch über exakt dasselbe
 * (dynamisch erkannte) Fenster integriert, das auch die Batterie-Entladung bewertet — kein
 * zweites, unabhängiges Zeitfenster oder eine zweite Annahme über die Abtastrate.
 */
function integratePowerKwh(points, startTs, endTs) {
    return integrateSignedPowerKwh(points, startTs, endTs, "all");
}
exports.integratePowerKwh = integratePowerKwh;
/**
 * Integriert nur Batterie-Entladung (powerW < 0) als positive kWh über [startTs, endTs].
 * Unabhängig von stündlichem SOC-Dedup und Kapazitäts-Mapping — direkte Energiebilanz.
 */
function integrateDischargeKwh(points, startTs, endTs) {
    return integrateSignedPowerKwh(points, startTs, endTs, "discharge");
}
exports.integrateDischargeKwh = integrateDischargeKwh;
function integrateSignedPowerKwh(points, startTs, endTs, mode) {
    if (!(endTs > startTs) || points.length === 0)
        return null;
    const sorted = points
        .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.powerW))
        .sort((a, b) => a.ts - b.ts);
    if (sorted.length === 0)
        return null;
    let kwh = 0;
    let coveredMs = 0;
    for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        if (cur.ts < startTs - constants_1.MS_PER_HOUR || cur.ts > endTs + constants_1.MS_PER_HOUR)
            continue;
        const prevTs = i > 0 ? sorted[i - 1].ts : cur.ts;
        const nextTs = i < sorted.length - 1 ? sorted[i + 1].ts : cur.ts;
        const segStart = Math.max(startTs, cur.ts - (cur.ts - prevTs) / 2);
        const segEnd = Math.min(endTs, cur.ts + (nextTs - cur.ts) / 2);
        const segMs = segEnd - segStart;
        if (segMs <= 0)
            continue;
        const power = mode === "discharge" ? (cur.powerW < 0 ? Math.abs(cur.powerW) : 0) : cur.powerW;
        kwh += (power * segMs) / 3_600_000_000;
        coveredMs += segMs;
    }
    /** Zu lückenhafte Abdeckung (< 50 % des Fensters) → kein belastbarer Wert. */
    if (coveredMs < (endTs - startTs) * 0.5)
        return null;
    return round2(kwh);
}

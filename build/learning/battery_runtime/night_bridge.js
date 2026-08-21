"use strict";
/**
 * PV-/Hauslast-Nachtbrücke: Abend = PV reicht nicht mehr (Batterie hilft),
 * Morgen = PV deckt wieder (Batterie muss nicht mehr helfen).
 * Feste Uhrzeiten nur Fallback — Winter/Sommer verschieben die Brücke um Stunden.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.average = exports.weightedAverage = exports.recencyWeight = exports.findNearestSoc = exports.findPvHouseNightBridges = exports.findSustainedNonDeficitStart = exports.findSustainedSurplusStart = exports.findSustainedDeficitStart = exports.buildBatteryDeficitSeries = exports.buildPvHouseNetSeries = exports.bucketPowerSeries = exports.NIGHT_BRIDGE_DEFICIT_W = exports.NIGHT_BRIDGE_BUCKET_MS = exports.DEFAULT_NIGHT_BRIDGE_FLUTTER_MS = void 0;
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
 * Fehlende Seite → null (kein Fake-0).
 */
function buildPvHouseNetSeries(pvPoints, housePoints, bucketMs = exports.NIGHT_BRIDGE_BUCKET_MS) {
    const pv = bucketPowerSeries(pvPoints, bucketMs);
    const house = bucketPowerSeries(housePoints, bucketMs);
    if (pv.length === 0 || house.length === 0)
        return [];
    const houseByBucket = new Map();
    for (const h of house) {
        houseByBucket.set(Math.floor(h.ts / bucketMs) * bucketMs, h.powerW);
    }
    const out = [];
    for (const p of pv) {
        const b = Math.floor(p.ts / bucketMs) * bucketMs;
        const hw = houseByBucket.get(b);
        if (hw === undefined)
            continue;
        out.push({ ts: p.ts, netW: p.powerW - hw });
    }
    return out;
}
exports.buildPvHouseNetSeries = buildPvHouseNetSeries;
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
/**
 * Gewichtetes Mittel: jüngere Nächte stärker (Halbwertszeit ~14 Tage).
 * Sonst bleibt der Sommer-Schnitt bei längeren Herbst-/Winternächten hängen.
 */
function recencyWeight(ageDays, halfLifeDays = 14) {
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

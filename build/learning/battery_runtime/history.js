"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distinctSocSampleDays = exports.readSecondsSinceFullCharge = exports.readLiveSoc = exports.readLiveCapacityKwh = exports.fetchPowerHistory = exports.fetchSitePowerFromEnergyCounter = exports.energyKwhSeriesToHourlyPowerW = exports.MIN_NIGHT_BRIDGE_SITE_POINTS = exports.fetchSitePowerSeries = exports.aggregatePowerPointsByHour = exports.resolveEffectivePowerInvert = exports.fetchSocHistoryRaw = exports.fetchSocHistory = exports.normalizeBatteryPowerW = exports.isValidCapacityKwh = exports.isValidSoc = exports.mergeDailyAstroTimes = exports.buildDailyAstroTimes = exports.fetchAstroTimeHistory = exports.parseAstroTimeValue = void 0;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const power_rollup_1 = require("../power_rollup");
const history_1 = require("../house_load/history");
const constants_1 = require("./constants");
const time_1 = require("./time");
function parseAstroTimeValue(raw) {
    if (raw === null || raw === undefined)
        return null;
    const text = String(raw).trim();
    const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return null;
    return { hour, minute };
}
exports.parseAstroTimeValue = parseAstroTimeValue;
async function fetchAstroTimeHistory(host, stateId, lookbackDays) {
    const points = [];
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const parsed = parseAstroTimeValue(row?.val);
        if (ts === null || !parsed)
            continue;
        points.push({
            ts,
            dateKey: (0, time_1.localDateKey)(new Date(ts)),
            hour: parsed.hour,
            minute: parsed.minute,
        });
    }
    points.sort((a, b) => a.ts - b.ts);
    return points;
}
exports.fetchAstroTimeHistory = fetchAstroTimeHistory;
/** Pro Kalendertag die zuletzt geschriebene Astro-Zeit (tägliches JS-Update). */
function buildDailyAstroTimes(points) {
    const startByDate = new Map();
    const endByDate = new Map();
    for (const p of points) {
        startByDate.set(p.dateKey, { hour: p.hour, minute: p.minute });
    }
    return { startByDate, endByDate };
}
exports.buildDailyAstroTimes = buildDailyAstroTimes;
function mergeDailyAstroTimes(startPoints, endPoints) {
    const start = buildDailyAstroTimes(startPoints);
    const end = buildDailyAstroTimes(endPoints);
    return { startByDate: start.startByDate, endByDate: end.endByDate };
}
exports.mergeDailyAstroTimes = mergeDailyAstroTimes;
function hourBucket(ts) {
    return Math.floor(ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
}
function isValidSoc(value) {
    if (value === null || !Number.isFinite(value))
        return false;
    return value >= constants_1.SOC_MIN && value <= constants_1.SOC_MAX;
}
exports.isValidSoc = isValidSoc;
function isValidCapacityKwh(value) {
    if (value === null || !Number.isFinite(value))
        return false;
    return value > 0 && value <= 500;
}
exports.isValidCapacityKwh = isValidCapacityKwh;
/**
 * Nach Normalisierung: positiv = laden, negativ = entladen.
 * @param invert Quell-Vorzeichen umdrehen (z. B. Sonnen pacTotal: + entladen, − laden).
 */
function normalizeBatteryPowerW(raw, invert = false) {
    if (raw === null || !Number.isFinite(raw))
        return null;
    const signed = invert ? -raw : raw;
    if (Math.abs(signed) > constants_1.PLAUSIBLE_POWER_W_MAX)
        return null;
    if (Math.abs(signed) < constants_1.POWER_DEADBAND_W)
        return null;
    return Math.round(signed);
}
exports.normalizeBatteryPowerW = normalizeBatteryPowerW;
async function fetchHistoryPoints(host, stateId, lookbackDays, parseVal) {
    const byHour = new Map();
    let lastValidTs = null;
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const value = parseVal(row?.val);
        if (ts === null || value === null)
            continue;
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
async function fetchSocHistory(host, stateId, lookbackDays) {
    const { points, lastValidTs } = await fetchHistoryPoints(host, stateId, lookbackDays, (raw) => {
        const n = (0, state_util_1.asNum)(raw);
        return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
    });
    return {
        points: points.map((p) => ({ ts: p.ts, socPct: p.value })),
        lastValidTs,
    };
}
exports.fetchSocHistory = fetchSocHistory;
/** Alle gültigen SOC-Punkte ohne Stunden-Dedup — für Vollladungs-Erkennung (Peaks zwischen Stunden). */
async function fetchSocHistoryRaw(host, stateId, lookbackDays) {
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const points = [];
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !isValidSoc(n))
            continue;
        points.push({ ts, socPct: Math.round(n * 100) / 100 });
    }
    points.sort((a, b) => a.ts - b.ts);
    return points;
}
exports.fetchSocHistoryRaw = fetchSocHistoryRaw;
/** Sonnen pacTotal: + entladen dominiert, − laden — Auto-Invert wenn Admin-Checkbox aus. */
function resolveEffectivePowerInvert(configuredInvert, rawRows) {
    if (configuredInvert) {
        return { invert: true, autoDetected: false };
    }
    let positive = 0;
    let negative = 0;
    for (const row of rawRows) {
        const n = (0, state_util_1.asNum)(row?.val);
        if (n === null || Math.abs(n) < constants_1.POWER_DEADBAND_W || Math.abs(n) > constants_1.PLAUSIBLE_POWER_W_MAX) {
            continue;
        }
        if (n > 0)
            positive++;
        else
            negative++;
    }
    // Typisches Sonnen-Muster: mehr positive Nacht-Entladewerte als negative Lade-Spitzen.
    if (positive >= 3 && negative >= 1 && positive > negative) {
        return { invert: true, autoDetected: true };
    }
    return { invert: false, autoDetected: false };
}
exports.resolveEffectivePowerInvert = resolveEffectivePowerInvert;
/**
 * Pro Stunde max. Lade- und max. Entladeleistung behalten (nicht nur letzter Wert).
 * Kurze PV-Ladespitzen gehen sonst verloren, wenn die Stunde mit Standby/Entladen endet.
 */
function aggregatePowerPointsByHour(rows, powerInvert) {
    const byHour = new Map();
    let normalizedRows = 0;
    let rawChargeSamples = 0;
    let rawDischargeSamples = 0;
    let lastValidTs = null;
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const w = normalizeBatteryPowerW((0, state_util_1.asNum)(row?.val), powerInvert);
        if (ts === null || w === null)
            continue;
        normalizedRows++;
        if (w > 0)
            rawChargeSamples++;
        else
            rawDischargeSamples++;
        const bucket = hourBucket(ts);
        const existing = byHour.get(bucket) ?? { ts, maxChargeW: null, maxDischargeW: null };
        if (w > 0) {
            existing.maxChargeW =
                existing.maxChargeW === null ? w : Math.max(existing.maxChargeW, w);
        }
        else {
            const magnitude = Math.abs(w);
            existing.maxDischargeW =
                existing.maxDischargeW === null ? magnitude : Math.max(existing.maxDischargeW, magnitude);
        }
        if (ts > existing.ts)
            existing.ts = ts;
        byHour.set(bucket, existing);
        if (lastValidTs === null || ts > lastValidTs)
            lastValidTs = ts;
    }
    const points = [];
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
exports.aggregatePowerPointsByHour = aggregatePowerPointsByHour;
function rowsToSitePowerPoints(rows, powerUnit) {
    const points = [];
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || n === null || !Number.isFinite(n) || n < 0)
            continue;
        let w = powerUnit === "kW" ? n * 1000 : n;
        /** Auto-kW wenn kleine Rohwerte (wie House-Load / Rollup-Backfill). */
        if (powerUnit === "W" && w > 0 && w < 100) {
            w = n * 1000;
        }
        if (!Number.isFinite(w) || w < 0 || w > constants_1.PLAUSIBLE_POWER_W_MAX)
            continue;
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
async function fetchSitePowerSeries(host, stateId, lookbackDays) {
    if (!stateId)
        return [];
    const fromRollup = await (0, power_rollup_1.fetchRollupUnidirectionalPowerPoints)(host, stateId, lookbackDays);
    if (fromRollup && fromRollup.points.length > 0) {
        /** Alter Rollup ohne Nacht-0 W → Aggregate bevorzugen (sonst greift pv_house nie). */
        const hasNightish = fromRollup.points.some((p) => p.powerW < 80);
        if (hasNightish) {
            return fromRollup.points;
        }
    }
    const powerUnit = host.getObjectAsync
        ? await (0, history_1.resolveHouseLoadPowerUnit)(host, stateId)
        : (0, history_1.detectPowerUnit)(stateId);
    const endMs = Date.now();
    const startMs = endMs - lookbackDays * constants_1.MS_PER_DAY;
    const aggregateRows = await (0, history_query_1.fetchHistoryRowsAggregated)(host, stateId, startMs, endMs, lookbackDays * 24 + 48, history_query_1.HISTORY_CHUNK_TIMEOUT_MS, "average", constants_1.MS_PER_HOUR);
    const fromAggregate = rowsToSitePowerPoints(aggregateRows, powerUnit);
    if (fromAggregate.length >= Math.min(lookbackDays, 7) * 8) {
        return fromAggregate;
    }
    const rawRows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
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
exports.fetchSitePowerSeries = fetchSitePowerSeries;
/** Mindestpunkte für belastbare PV/Haus-Nachtbrücke (≈ 2 Tage à 12 h). */
exports.MIN_NIGHT_BRIDGE_SITE_POINTS = 48;
/**
 * Tages-/Lebensenergie-Zähler → stündliche Leistung (W).
 * Nachts stagniert der Zähler → ~0 W — genau das braucht die PV/Haus-Brücke,
 * wenn bat_pv_ac keine History hat.
 */
function energyKwhSeriesToHourlyPowerW(samples) {
    if (samples.length < 2)
        return [];
    const sorted = [...samples].sort((a, b) => a.ts - b.ts);
    const byHour = new Map();
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const dKwh = cur.kwh - prev.kwh;
        const dtMs = cur.ts - prev.ts;
        if (!(dtMs > 60_000) || dKwh < -0.001)
            continue;
        const avgW = Math.min(constants_1.PLAUSIBLE_POWER_W_MAX, Math.max(0, (dKwh * 3_600_000_000) / dtMs));
        const startBucket = Math.floor(prev.ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
        const endBucket = Math.floor(cur.ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
        for (let b = startBucket; b <= endBucket; b += constants_1.MS_PER_HOUR) {
            const curBucket = byHour.get(b) ?? { sumW: 0, n: 0 };
            curBucket.sumW += avgW;
            curBucket.n += 1;
            byHour.set(b, curBucket);
        }
    }
    return [...byHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([b, v]) => ({
        ts: b + constants_1.MS_PER_HOUR / 2,
        powerW: Math.round(v.sumW / Math.max(1, v.n)),
    }));
}
exports.energyKwhSeriesToHourlyPowerW = energyKwhSeriesToHourlyPowerW;
function detectEnergyUnitIsWh(values) {
    const positive = values.filter((v) => v > 0);
    if (positive.length < 4)
        return false;
    const sorted = [...positive].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    /** Typische Tageszähler < 200 kWh; Wh-Zähler oft Tausende. */
    return median >= 500;
}
/**
 * PV-Leistung aus Energiezähler-Historie (PV-Bias Ist-State), wenn PV-AC-History fehlt.
 */
async function fetchSitePowerFromEnergyCounter(host, energyStateId, lookbackDays) {
    if (!energyStateId || lookbackDays <= 0)
        return [];
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, energyStateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const rawVals = [];
    for (const row of rows) {
        const n = (0, state_util_1.asNum)(row?.val);
        if (n !== null && Number.isFinite(n) && n >= 0)
            rawVals.push(n);
    }
    const asWh = detectEnergyUnitIsWh(rawVals);
    const samples = [];
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const n = (0, state_util_1.asNum)(row?.val);
        if (ts === null || n === null || !Number.isFinite(n) || n < 0)
            continue;
        samples.push({ ts, kwh: asWh ? n / 1000 : n });
    }
    return energyKwhSeriesToHourlyPowerW(samples);
}
exports.fetchSitePowerFromEnergyCounter = fetchSitePowerFromEnergyCounter;
async function fetchPowerHistory(host, stateId, lookbackDays, powerInvert = false) {
    const rollup = await (0, power_rollup_1.fetchRollupPowerHistory)(host, stateId, lookbackDays);
    if (rollup) {
        return {
            points: rollup.points,
            lastValidTs: rollup.lastValidTs,
            meta: rollup.meta,
        };
    }
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
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
exports.fetchPowerHistory = fetchPowerHistory;
async function readLiveCapacityKwh(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        return isValidCapacityKwh(n) ? Math.round(n * 1000) / 1000 : null;
    }
    catch {
        return null;
    }
}
exports.readLiveCapacityKwh = readLiveCapacityKwh;
async function readLiveSoc(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        return isValidSoc(n) ? Math.round(n * 100) / 100 : null;
    }
    catch {
        return null;
    }
}
exports.readLiveSoc = readLiveSoc;
/** Geräte-State: Sekunden seit letzter Vollladung (Sonnen: latestData.secondsSinceFullCharge). */
async function readSecondsSinceFullCharge(host, stateId) {
    if (!stateId) {
        return null;
    }
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        const n = (0, state_util_1.asNum)(st?.val);
        if (n === null || !Number.isFinite(n) || n < 0) {
            return null;
        }
        return Math.round(n);
    }
    catch {
        return null;
    }
}
exports.readSecondsSinceFullCharge = readSecondsSinceFullCharge;
function distinctSocSampleDays(points) {
    return new Set(points.map((p) => new Date(p.ts).toISOString().slice(0, 10))).size;
}
exports.distinctSocSampleDays = distinctSocSampleDays;

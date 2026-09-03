"use strict";
/**
 * Stündlicher Temperaturforecast aus vorhandenem BrightSky-Prefix.
 * Keine neue Wetterarchitektur, keine Interpolation, fehlende Stunden bleiben weg.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.weatherHourlyHorizonEnd = exports.weatherHourlyDayIndex = exports.collectWeatherHourlyPoints = exports.WEATHER_HOURLY_PROBE_COUNT = void 0;
const state_util_1 = require("../../ems_light/state_util");
const math_1 = require("../../learning/weather/horizon/math");
const time_1 = require("../time");
/** Heute + Folgetag (Planner-Horizont), ohne erfundene Stunden. */
exports.WEATHER_HOURLY_PROBE_COUNT = 48;
async function readForeignNum(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = await host.getForeignStateAsync?.(stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readForeignStr(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = await host.getForeignStateAsync?.(stateId);
        if (st?.val == null)
            return null;
        const s = String(st.val).trim();
        return s || null;
    }
    catch {
        return null;
    }
}
async function readOwnNum(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
function dayIndexFromDateKeys(todayKey, hourKey) {
    const t = Date.parse(`${todayKey}T00:00:00Z`);
    const h = Date.parse(`${hourKey}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(h))
        return 1;
    return Math.round((h - t) / 86_400_000) + 1;
}
/**
 * Liest BrightSky-artige Stunden (`prefix.NN.timestamp` / `.temperature` / `.cloud_cover`).
 * Ohne timestamp: Stunde wird nicht erzeugt.
 * Temperatur fehlt: outdoorTempC = null (kein Schätzwert).
 * Vorhandener `learning.weather.temp_bias_c` wird wie beim Horizon angewendet.
 */
async function collectWeatherHourlyPoints(host, now, timezone, brightskyHourlyPrefix) {
    const prefix = brightskyHourlyPrefix.trim();
    if (!prefix)
        return [];
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const tempBiasC = await readOwnNum(host, "learning.weather.temp_bias_c");
    const indices = Array.from({ length: exports.WEATHER_HOURLY_PROBE_COUNT }, (_, i) => String(i).padStart(2, "0"));
    const rows = await Promise.all(indices.map(async (idx) => {
        const base = `${prefix}.${idx}`;
        const [timestampRaw, rawTempC, cloudPct] = await Promise.all([
            readForeignStr(host, `${base}.timestamp`),
            readForeignNum(host, `${base}.temperature`),
            readForeignNum(host, `${base}.cloud_cover`),
        ]);
        if (!timestampRaw)
            return null;
        const ms = Date.parse(timestampRaw);
        if (!Number.isFinite(ms))
            return null;
        const start = new Date(ms);
        const hourKey = (0, time_1.localDateKeyInTimezone)(start, timezone);
        const dayIndex = dayIndexFromDateKeys(todayKey, hourKey);
        const outdoorTempC = (0, math_1.correctHorizonTempC)(rawTempC, tempBiasC, dayIndex);
        const point = {
            startIso: start.toISOString(),
            endIso: new Date(ms + 3_600_000).toISOString(),
            outdoorTempC,
            cloudPct,
        };
        return point;
    }));
    return rows.filter((r) => r !== null);
}
exports.collectWeatherHourlyPoints = collectWeatherHourlyPoints;
/** Sichtbar für Tests — reiner dayIndex-Abgleich ohne IO. */
function weatherHourlyDayIndex(todayKey, hourDateKey) {
    return dayIndexFromDateKeys(todayKey, hourDateKey);
}
exports.weatherHourlyDayIndex = weatherHourlyDayIndex;
function weatherHourlyHorizonEnd(todayKey) {
    return `${(0, time_1.addDaysToDateKey)(todayKey, 1)}T23:59:59.999Z`;
}
exports.weatherHourlyHorizonEnd = weatherHourlyHorizonEnd;

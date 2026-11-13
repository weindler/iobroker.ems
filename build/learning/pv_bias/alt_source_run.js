"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALT_CAPTURE_WINDOW_MS = void 0;
exports.shouldCaptureAlt = shouldCaptureAlt;
exports.readAltLive = readAltLive;
exports.runAltSourceCapture = runAltSourceCapture;
const state_util_1 = require("../../ems_light/state_util");
const daily_persist_1 = require("./daily_persist");
const dates_1 = require("./dates");
const history_1 = require("./history");
/** Zweitquelle nur kurz nach der Freeze-Zeit erfassen, sonst wäre der Tageswert nicht mehr vergleichbar. */
exports.ALT_CAPTURE_WINDOW_MS = 3 * 3_600_000;
function shouldCaptureAlt(now, freezeTime, alreadyCaptured) {
    if (alreadyCaptured)
        return false;
    const freezeMs = (0, dates_1.freezeInstantMs)(freezeTime, now);
    if (freezeMs === null)
        return false;
    const t = now.getTime();
    return t >= freezeMs && t <= freezeMs + exports.ALT_CAPTURE_WINDOW_MS;
}
/** Liest die Zweitquelle live (heute/morgen). */
async function readAltLive(host, alt) {
    return {
        today: await (0, history_1.readStateNum)(host, alt.todayStateId),
        tomorrow: await (0, history_1.readStateNum)(host, alt.tomorrowStateId),
    };
}
/** Friert die Zweitquelle für heute einmal ein (neben Hauptforecast + Ist in pv_bias_daily_v1.json). */
async function runAltSourceCapture(host, cfg, alt, now = new Date()) {
    if (typeof host.getAbsolutePath !== "function")
        return false;
    const dir = host.getAbsolutePath("learning/pv_bias");
    const persist = await (0, daily_persist_1.readDailyPersist)(dir);
    const dateKey = (0, dates_1.localDateKey)(now);
    const existing = (0, daily_persist_1.dailyRecord)(persist, dateKey);
    if (!shouldCaptureAlt(now, cfg.freezeTime, existing?.altForecastKwh != null))
        return false;
    const value = (0, state_util_1.asNum)((await readAltLive(host, alt)).today);
    if (value === null || !(value > 0))
        return false;
    const updated = (0, daily_persist_1.upsertDailyRecord)(persist, {
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
    await (0, daily_persist_1.writeDailyPersist)(dir, updated);
    host.log.debug?.(`PV-Zweitquelle: ${value} kWh für ${dateKey} eingefroren (${alt.todayStateId}).`);
    return true;
}

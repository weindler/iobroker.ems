"use strict";
/**
 * Read-only VIS: PV je Stunde für heute und morgen (Prognose aus dem Tagesplan, gemessen aus den Stundenwerten).
 * Keine eigene Prognose, keine Planungslogik — nur Umformung vorhandener Werte.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIS_PV_HOURLY_STATE_ID = void 0;
exports.buildVisPvHourly = buildVisPvHourly;
exports.emptyVisPvHourly = emptyVisPvHourly;
exports.VIS_PV_HOURLY_STATE_ID = "operator.vis.pv_hourly_json";
function localParts(ms, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
    return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}
const round3 = (n) => Math.round(n * 1000) / 1000;
function buildVisPvHourly(input) {
    const nowMs = input.now.getTime();
    const today = localParts(nowMs, input.timezone);
    const tomorrow = localParts(nowMs + 24 * 3_600_000, input.timezone);
    const wanted = [
        { key: today.dateKey, label: "Heute" },
        { key: tomorrow.dateKey, label: "Morgen" },
    ];
    const forecast = new Map(); // "YYYY-MM-DD|h" -> kWh
    for (const s of input.slots) {
        const start = Date.parse(s.slot?.startIso ?? "");
        const end = Date.parse(s.slot?.endIso ?? "");
        const w = s.pvForecastPowerW;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
        if (typeof w !== "number" || !Number.isFinite(w) || w < 0)
            continue;
        const lp = localParts(start, input.timezone);
        const key = `${lp.dateKey}|${lp.hour}`;
        forecast.set(key, (forecast.get(key) ?? 0) + (w * (end - start)) / 3_600_000 / 1000);
    }
    const measured = new Map();
    for (const p of input.measured) {
        if (!Number.isFinite(p.hourStartMs) || !Number.isFinite(p.avgW) || p.hourStartMs > nowMs)
            continue;
        const lp = localParts(p.hourStartMs, input.timezone);
        measured.set(`${lp.dateKey}|${lp.hour}`, Math.max(0, p.avgW) / 1000);
    }
    const days = wanted.map(({ key, label }) => {
        const hours = [];
        let fSum = 0;
        let mSum = 0;
        for (let h = 0; h < 24; h++) {
            const f = forecast.get(`${key}|${h}`);
            const m = label === "Heute" ? measured.get(`${key}|${h}`) : undefined;
            if (f === undefined && m === undefined)
                continue;
            if ((f ?? 0) < 0.005 && (m ?? 0) < 0.005)
                continue;
            hours.push({ h, f: f === undefined ? null : round3(f), m: m === undefined ? null : round3(m) });
            fSum += f ?? 0;
            mSum += m ?? 0;
        }
        return { dateKey: key, label, hours, forecastKwh: round3(fSum), measuredKwh: round3(mSum) };
    });
    return {
        generatedAt: input.now.toISOString(),
        timezone: input.timezone,
        nowHour: today.hour,
        nowMs,
        days,
        series: buildSeries(nowMs, input),
        outlook: input.outlook ?? [],
    };
}
const HOUR_MS = 3_600_000;
const SERIES_BACK_H = 72;
const SERIES_FWD_H = 72;
function buildSeries(nowMs, input) {
    const cur = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    const f = new Map();
    for (const [k, v] of Object.entries(input.forecastByHour ?? {}))
        f.set(Number(k), v);
    /* aktuelle Planwerte überschreiben den gespeicherten Verlauf für laufende/künftige Stunden */
    const plan = new Map();
    for (const sl of input.slots) {
        const start = Date.parse(sl.slot?.startIso ?? "");
        const end = Date.parse(sl.slot?.endIso ?? "");
        const w = sl.pvForecastPowerW;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
        if (typeof w !== "number" || !Number.isFinite(w) || w < 0)
            continue;
        const h = Math.floor(start / HOUR_MS) * HOUR_MS;
        plan.set(h, (plan.get(h) ?? 0) + (w * (end - start)) / HOUR_MS / 1000);
    }
    for (const [t, v] of plan)
        if (t >= cur)
            f.set(t, v);
    const m = new Map();
    for (const p of input.measured) {
        if (!Number.isFinite(p.hourStartMs) || !Number.isFinite(p.avgW) || p.hourStartMs > nowMs)
            continue;
        m.set(Math.floor(p.hourStartMs / HOUR_MS) * HOUR_MS, Math.max(0, p.avgW) / 1000);
    }
    const b = new Map();
    for (const [k, v] of Object.entries(input.brightskyByHour ?? {}))
        b.set(Number(k), v);
    const out = [];
    for (let t = cur - SERIES_BACK_H * HOUR_MS; t <= cur + SERIES_FWD_H * HOUR_MS; t += HOUR_MS) {
        const fv = f.get(t);
        const bv = b.get(t);
        const mv = m.get(t);
        if (fv === undefined && bv === undefined && mv === undefined)
            continue;
        out.push({
            t,
            f: fv === undefined ? null : round3(fv),
            b: bv === undefined ? null : round3(bv),
            m: mv === undefined ? null : round3(mv),
        });
    }
    return out;
}
function emptyVisPvHourly(now, timezone = "Europe/Berlin") {
    return { generatedAt: now.toISOString(), timezone, nowHour: localParts(now.getTime(), timezone).hour, nowMs: now.getTime(), days: [], series: [], outlook: [] };
}

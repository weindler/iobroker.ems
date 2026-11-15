"use strict";
/**
 * Publish compact VIS price-board JSON from already-written operator states.
 * Display only — never changes Thermal/Battery/EV/Climate/Planner decisions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishVisPriceTimeline = publishVisPriceTimeline;
exports.publishVisPvHourly = publishVisPvHourly;
const states_1 = require("../daily_plan/states");
const persist_1 = require("../../learning/power_rollup/persist");
const hour_1 = require("../../learning/power_rollup/hour");
const pv_hourly_history_1 = require("./pv_hourly_history");
const pv_shape_config_1 = require("../contributions/pv_shape_config");
const alt_source_1 = require("../../learning/pv_bias/alt_source");
const pv_hourly_1 = require("./pv_hourly");
const grid_states_1 = require("../supply/grid_states");
const grid_read_1 = require("../supply/grid_read");
const price_history_1 = require("./price_history");
const run_1 = require("../../learning/energyforecast/run");
const state_util_1 = require("../../ems_light/state_util");
const state_write_1 = require("../../policy/core/state_write");
const ensure_states_1 = require("../../addons/battery/ensure_states");
const price_timeline_1 = require("./price_timeline");
function parseJsonArray(raw) {
    if (Array.isArray(raw))
        return raw;
    if (typeof raw !== "string" || !raw.trim())
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function asGridSlots(raw) {
    return parseJsonArray(raw).filter((row) => row != null && typeof row === "object");
}
/**
 * Preisachse über den Plan-Horizont hinaus: Energyforecast-Slots (Prognose) ergänzen alle Zeiten ohne
 * Slot aus dem Grid-Supply-State. Tibber/Grid-Supply hat Vorrang.
 */
function mergeForecastSlots(slots, now) {
    const known = new Set();
    for (const s of slots) {
        const ms = typeof s.startIso === "string" ? Date.parse(s.startIso) : NaN;
        if (Number.isFinite(ms))
            known.add(ms);
    }
    const out = [...slots];
    for (const f of (0, run_1.getEnergyforecastPrice15MinSlots)(now.getTime())) {
        if (known.has(f.slotStartMs))
            continue;
        out.push({
            startIso: new Date(f.slotStartMs).toISOString(),
            endIso: new Date(f.slotStartMs + 15 * 60_000).toISOString(),
            priceCtPerKwh: f.priceCtPerKwh,
        });
    }
    return out;
}
function asAlloc(raw) {
    return parseJsonArray(raw).filter((row) => row != null && typeof row === "object");
}
async function readVal(host, id) {
    try {
        const st = await host.getStateAsync(id);
        return st?.val;
    }
    catch {
        return null;
    }
}
/** Echte Preise fortschreiben und vergangene Viertelstunden (die der Preisdienst nicht mehr liefert) ergänzen. */
async function withPriceHistory(host, gridSlots, forecastOnly, nowMs) {
    try {
        const dir = host.getAbsolutePath?.(price_history_1.PRICE_HISTORY_CATEGORY);
        if (!dir)
            return gridSlots;
        const known = new Set();
        const actual = [];
        for (const s of gridSlots) {
            const ms = typeof s.startIso === "string" ? Date.parse(s.startIso) : NaN;
            if (!Number.isFinite(ms))
                continue;
            known.add(ms);
            const ct = typeof s.priceCtPerKwh === "number" ? s.priceCtPerKwh : null;
            if (ct !== null && !forecastOnly.has(ms))
                actual.push([ms, ct]);
        }
        const prev = await (0, price_history_1.readPriceHistory)(dir);
        const { history, changed } = (0, price_history_1.mergePriceHistory)(prev, nowMs, actual);
        if (changed)
            await (0, price_history_1.writePriceHistory)(dir, history);
        const out = [...gridSlots];
        for (const [k, ct] of Object.entries(history.a)) {
            const ms = Number(k);
            if (known.has(ms) || ms >= nowMs)
                continue;
            out.push({ startIso: new Date(ms).toISOString(), endIso: new Date(ms + 15 * 60_000).toISOString(), priceCtPerKwh: ct });
        }
        return out;
    }
    catch {
        return gridSlots;
    }
}
async function publishVisPriceTimeline(host, now = new Date()) {
    let board = (0, price_timeline_1.emptyVisPriceTimeline)(now);
    try {
        const [gridSlotsRaw, gridNow, liveNow, gbMin, gbAllowed, batteryAlloc, wallboxAlloc, immersionAlloc, climateAlloc,] = await Promise.all([
            readVal(host, grid_states_1.GRID_SUPPLY_STATE_IDS.slotsJson),
            readVal(host, grid_states_1.GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh),
            readVal(host, "live.price.now_ct_per_kwh"),
            readVal(host, ensure_states_1.BAT.gridBalance.priceMinCtKwh),
            readVal(host, ensure_states_1.BAT.gridBalance.priceAllowed),
            readVal(host, states_1.ALLOCATION_ADDON_STATE_IDS.battery.planJson),
            readVal(host, states_1.ALLOCATION_ADDON_STATE_IDS.wallbox.planJson),
            readVal(host, states_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson),
            readVal(host, states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson),
        ]);
        const currentPriceCt = (0, state_util_1.asNum)(liveNow) ?? (0, state_util_1.asNum)(gridNow);
        const gbMinPriceCt = (0, state_util_1.asNum)(gbMin);
        const gbPriceAllowed = gbAllowed === true ? true : gbAllowed === false ? false : null;
        const gridSlots = mergeForecastSlots(asGridSlots(gridSlotsRaw), now);
        const forecastOnly = (0, grid_read_1.getForecastOnlyPriceStarts)();
        const withHistory = await withPriceHistory(host, gridSlots, forecastOnly, now.getTime());
        board = (0, price_timeline_1.buildVisPriceTimeline)({
            now,
            currentPriceCt,
            gbMinPriceCt,
            gbPriceAllowed,
            gridSlots: withHistory,
            forecastStartsMs: forecastOnly,
            frozenForecastCt: (0, run_1.getEnergyforecastFrozenForecast)(),
            batteryAlloc: asAlloc(batteryAlloc),
            wallboxAlloc: asAlloc(wallboxAlloc),
            immersionAlloc: asAlloc(immersionAlloc),
            climateAlloc: asAlloc(climateAlloc),
        });
    }
    catch {
        board = (0, price_timeline_1.emptyVisPriceTimeline)(now);
    }
    await (0, state_write_1.setStateIfChanged)(host, price_timeline_1.VIS_PRICE_TIMELINE_STATE_ID, JSON.stringify(board));
}
const BRIGHTSKY_DEFAULT_HOURLY_PREFIX = "brightsky.0.hourly";
const BRIGHTSKY_HOURS_PROBED = 48;
async function readForeign(host, id) {
    try {
        const reader = host.getForeignStateAsync;
        return (await reader?.call(host, id))?.val ?? null;
    }
    catch {
        return null;
    }
}
/** Brightsky-Stunden (Einstrahlung) und Tagesschätzungen lesen; fehlt etwas, bleibt die Kurve leer. */
async function readBrightskyCurve(host, timezone) {
    const config = host.config;
    const prefix = (0, pv_shape_config_1.pvShapeConfigFromAdapter)(config).brightskyHourlyPrefix.trim() || BRIGHTSKY_DEFAULT_HOURLY_PREFIX;
    const alt = (0, alt_source_1.altSourceConfigFromAdapter)(config);
    const idx = Array.from({ length: BRIGHTSKY_HOURS_PROBED }, (_, i) => String(i).padStart(2, "0"));
    const rows = await Promise.all(idx.map(async (n) => {
        const [ts, solar] = await Promise.all([readForeign(host, `${prefix}.${n}.timestamp`), readForeign(host, `${prefix}.${n}.solar`)]);
        const ms = Date.parse(String(ts ?? ""));
        const sv = (0, state_util_1.asNum)(solar);
        return Number.isFinite(ms) && sv !== null ? { startMs: ms, solar: sv } : null;
    }));
    const points = rows.filter((r) => r !== null);
    if (!points.length)
        return new Map();
    const fmtKey = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
    const estimates = new Map();
    const dayIds = [alt.todayStateId, alt.tomorrowStateId, alt.tomorrowStateId.replace(/daily\.01\./, "daily.02.")];
    const nowMs = Date.now();
    for (let d = 0; d < dayIds.length; d++) {
        if (d === 2 && dayIds[2] === dayIds[1])
            break;
        const v = (0, state_util_1.asNum)(await readForeign(host, dayIds[d]));
        if (v !== null && v > 0)
            estimates.set(fmtKey(nowMs + d * 24 * 3_600_000), v);
    }
    return (0, pv_hourly_history_1.brightskyHourlyKwh)(points, estimates, timezone);
}
const BRIGHTSKY_OUTLOOK_DAYS = 14;
/** Brightsky-Tagesschätzungen (kWh) ab heute; endet beim ersten fehlenden Tag. */
async function readBrightskyOutlook(host, timezone, nowMs) {
    const alt = (0, alt_source_1.altSourceConfigFromAdapter)(host.config);
    if (!/daily\.00\./.test(alt.todayStateId))
        return [];
    const fmtKey = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
    const ids = Array.from({ length: BRIGHTSKY_OUTLOOK_DAYS }, (_, d) => alt.todayStateId.replace(/daily\.00\./, `daily.${String(d).padStart(2, "0")}.`));
    const vals = await Promise.all(ids.map((id) => readForeign(host, id)));
    const out = [];
    for (let d = 0; d < vals.length; d++) {
        const v = (0, state_util_1.asNum)(vals[d]);
        if (v === null || v < 0)
            break;
        out.push({ dateKey: fmtKey(nowMs + d * 24 * 3_600_000), b: Math.round(v * 100) / 100 });
    }
    return out;
}
let pvHourlyLastMs = 0;
const PV_HOURLY_MIN_INTERVAL_MS = 5 * 60_000;
/** PV-Stundenwerte für die Betriebsseite. Höchstens alle 5 Minuten (der Tagesplan ist groß). */
async function publishVisPvHourly(host, now = new Date(), timezone = "Europe/Berlin") {
    const nowMs = now.getTime();
    if (nowMs - pvHourlyLastMs < PV_HOURLY_MIN_INTERVAL_MS)
        return;
    pvHourlyLastMs = nowMs;
    let board = (0, pv_hourly_1.emptyVisPvHourly)(now, timezone);
    try {
        const rawPlan = await readVal(host, states_1.DAILY_PLAN_STATE_IDS.planJson);
        let slots = [];
        if (typeof rawPlan === "string" && rawPlan.trim()) {
            const parsed = JSON.parse(rawPlan);
            if (Array.isArray(parsed.slots))
                slots = parsed.slots;
        }
        const measured = [];
        try {
            const dir = host.getAbsolutePath?.("learning/power_rollup");
            if (dir) {
                const persist = await (0, persist_1.readPowerHourlyPersist)(dir);
                const source = persist.sources["battery.pv_ac_power_w"];
                if (source) {
                    const cutoff = nowMs - 75 * 3_600_000;
                    for (const [key, rec] of Object.entries(source.hours)) {
                        const start = (0, hour_1.hourKeyToStartTs)(key);
                        if (start >= cutoff && typeof rec.avgPowerW === "number")
                            measured.push({ hourStartMs: start, avgW: rec.avgPowerW });
                    }
                }
            }
        }
        catch {
            /* gemessene Stunden sind optional */
        }
        /* Verlauf (EMS-Prognose + Brightsky) fortschreiben, damit der Rückblick erhalten bleibt */
        let history = { version: 1, f: {}, b: {} };
        try {
            const hdir = host.getAbsolutePath?.(pv_hourly_history_1.PV_HOURLY_HISTORY_CATEGORY);
            const planByHour = new Map();
            for (const sl of slots) {
                const a = Date.parse(sl.slot?.startIso ?? "");
                const e = Date.parse(sl.slot?.endIso ?? "");
                const w = sl.pvForecastPowerW;
                if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a || typeof w !== "number" || !(w >= 0))
                    continue;
                const h = (0, pv_hourly_history_1.floorHour)(a);
                planByHour.set(h, (planByHour.get(h) ?? 0) + (w * (e - a)) / 3_600_000 / 1000);
            }
            const bs = await readBrightskyCurve(host, timezone);
            if (hdir) {
                const prev = await (0, pv_hourly_history_1.readPvHourlyHistory)(hdir);
                history = (0, pv_hourly_history_1.mergePvHistory)(prev, nowMs, planByHour, bs);
                await (0, pv_hourly_history_1.writePvHourlyHistory)(hdir, history);
            }
            else {
                history = (0, pv_hourly_history_1.mergePvHistory)({ version: 1, f: {}, b: {} }, nowMs, planByHour, bs);
            }
        }
        catch {
            /* Verlauf ist optional */
        }
        let outlook = [];
        try {
            outlook = await readBrightskyOutlook(host, timezone, nowMs);
        }
        catch {
            /* Wochenausblick ist optional */
        }
        board = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone, slots, measured, forecastByHour: history.f, brightskyByHour: history.b, outlook });
    }
    catch {
        board = (0, pv_hourly_1.emptyVisPvHourly)(now, timezone);
    }
    await (0, state_write_1.setStateIfChanged)(host, pv_hourly_1.VIS_PV_HOURLY_STATE_ID, JSON.stringify(board));
}

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
const pv_hourly_1 = require("./pv_hourly");
const grid_states_1 = require("../supply/grid_states");
const grid_read_1 = require("../supply/grid_read");
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
        board = (0, price_timeline_1.buildVisPriceTimeline)({
            now,
            currentPriceCt,
            gbMinPriceCt,
            gbPriceAllowed,
            gridSlots: mergeForecastSlots(asGridSlots(gridSlotsRaw), now),
            forecastStartsMs: (0, grid_read_1.getForecastOnlyPriceStarts)(),
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
                    const cutoff = nowMs - 36 * 3_600_000;
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
        board = (0, pv_hourly_1.buildVisPvHourly)({ now, timezone, slots, measured });
    }
    catch {
        board = (0, pv_hourly_1.emptyVisPvHourly)(now, timezone);
    }
    await (0, state_write_1.setStateIfChanged)(host, pv_hourly_1.VIS_PV_HOURLY_STATE_ID, JSON.stringify(board));
}

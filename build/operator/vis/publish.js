"use strict";
/**
 * Publish compact VIS price-board JSON from already-written operator states.
 * Display only — never changes Thermal/Battery/EV/Climate/Planner decisions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishVisPriceTimeline = void 0;
const states_1 = require("../daily_plan/states");
const grid_states_1 = require("../supply/grid_states");
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
            gridSlots: asGridSlots(gridSlotsRaw),
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
exports.publishVisPriceTimeline = publishVisPriceTimeline;

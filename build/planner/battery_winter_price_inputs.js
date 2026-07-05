"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTibber15MinPriceSlots = void 0;
const config_1 = require("../learning/price_forecast/config");
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
async function readForeignVal(host, stateId) {
    if (!stateId.trim())
        return null;
    const tryRead = async (fn) => {
        if (!fn)
            return null;
        try {
            const st = await fn.call(host, stateId);
            return st?.val ?? null;
        }
        catch {
            return null;
        }
    };
    const foreign = await tryRead(host.getForeignStateAsync);
    if (foreign !== null && foreign !== undefined)
        return foreign;
    return tryRead(host.getStateAsync);
}
/** Liest Tibber Today/Tomorrow-JSON und liefert sortierte 15-min-Preisslots ab jetzt. */
async function readTibber15MinPriceSlots(host, now) {
    const cfg = (0, config_1.priceForecastConfigFromAdapter)(host.config);
    if (!cfg.todayJsonStateId && !cfg.tomorrowJsonStateId) {
        return [];
    }
    const minStartMs = now.getTime();
    const byStart = new Map();
    for (const stateId of [cfg.todayJsonStateId, cfg.tomorrowJsonStateId]) {
        if (!stateId)
            continue;
        const raw = await readForeignVal(host, stateId);
        for (const slot of (0, tibber_parse_1.parseTibberPriceJsonTo15MinSlots)(raw, { minStartMs })) {
            byStart.set(slot.slotStartMs, slot);
        }
    }
    return [...byStart.values()].sort((a, b) => a.slotStartMs - b.slotStartMs);
}
exports.readTibber15MinPriceSlots = readTibber15MinPriceSlots;

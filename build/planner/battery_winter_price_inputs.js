"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTibber15MinPriceSlots = void 0;
const grid_1 = require("../operator/supply/grid");
const grid_read_1 = require("../operator/supply/grid_read");
/** Liefert 15-min-Preisslots über die gemeinsame Grid-Supply-Schicht. */
async function readTibber15MinPriceSlots(host, now) {
    const input = await (0, grid_read_1.collectGridSupplyBuildInput)(host, now);
    const forecast = (0, grid_1.buildGridSupplyForecast)(input);
    return (0, grid_1.gridSlotsToPrice15Min)(forecast.slots);
}
exports.readTibber15MinPriceSlots = readTibber15MinPriceSlots;

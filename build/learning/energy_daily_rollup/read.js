"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRollupDayKwh = void 0;
const persist_1 = require("./persist");
const PERSIST_CATEGORY = "learning/energy_daily_rollup";
async function fetchRollupDayKwh(host, stateId, dateKey) {
    const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
    if (!dir || !stateId) {
        return null;
    }
    const persist = await (0, persist_1.readEnergyDailyPersist)(dir);
    for (const source of Object.values(persist.sources)) {
        if (source.stateId !== stateId) {
            continue;
        }
        const rec = source.days[dateKey];
        if (rec?.kwh && rec.kwh > 0) {
            return rec.kwh;
        }
    }
    return null;
}
exports.fetchRollupDayKwh = fetchRollupDayKwh;

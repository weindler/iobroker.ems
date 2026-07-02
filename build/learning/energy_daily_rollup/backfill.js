"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEnergyDailyRollupBackfill = exports.backfillDailyEnergySource = void 0;
const history_1 = require("../pv_bias/history");
const dates_1 = require("../pv_bias/dates");
const persist_1 = require("./persist");
const MIN_BACKFILL_DAYS = 7;
async function backfillDailyEnergySource(host, source) {
    const baseDir = host.getAbsolutePath?.("learning/energy_daily_rollup");
    if (!baseDir) {
        return false;
    }
    let persist = await (0, persist_1.readEnergyDailyPersist)(baseDir);
    const existing = persist.sources[source.sourceKey];
    if (existing?.backfillDone && Object.keys(existing.days).length >= MIN_BACKFILL_DAYS) {
        return false;
    }
    host.log.info(`Energy-Daily-Rollup backfill: ${source.sourceKey} (${source.lookbackDays}d, ${source.stateId})…`);
    const mergedDays = { ...(existing?.days ?? {}) };
    for (let dayOffset = 1; dayOffset < source.lookbackDays; dayOffset++) {
        const { start, end } = (0, history_1.dayBoundsMs)(dayOffset);
        const dateKey = (0, dates_1.localDateKey)(new Date(start));
        if (mergedDays[dateKey]?.kwh) {
            continue;
        }
        const last = await (0, history_1.fetchDayLastValue)(host, source.stateId, start, end);
        if (last === null || last <= 0) {
            continue;
        }
        const rec = {
            dateKey,
            kwh: Math.round(last * 1000) / 1000,
            lastSampleTs: end - 60_000,
            sampleCount: 1,
        };
        mergedDays[dateKey] = (0, persist_1.mergeDayRecord)(mergedDays[dateKey], rec);
    }
    persist = (0, persist_1.upsertSourcePersist)(persist, {
        sourceKey: source.sourceKey,
        stateId: source.stateId,
        backfillDone: true,
        days: mergedDays,
    });
    await (0, persist_1.writeEnergyDailyPersist)(baseDir, persist);
    host.log.info(`Energy-Daily-Rollup backfill done: ${source.sourceKey} persisted_days=${Object.keys(mergedDays).length}`);
    return true;
}
exports.backfillDailyEnergySource = backfillDailyEnergySource;
async function ensureEnergyDailyRollupBackfill(host, sources) {
    for (const source of sources) {
        try {
            await backfillDailyEnergySource(host, source);
        }
        catch (e) {
            host.log.warn(`Energy-Daily-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
exports.ensureEnergyDailyRollupBackfill = ensureEnergyDailyRollupBackfill;

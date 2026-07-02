"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePowerRollupBackfill = exports.backfillDensePowerSource = void 0;
const history_1 = require("../battery_runtime/history");
const history_query_1 = require("../history_query");
const hour_1 = require("./hour");
const persist_1 = require("./persist");
const MIN_BACKFILL_HOURS = 24;
function hourRecordFromAggregate(hourKey, maxChargeW, maxDischargeW, lastSampleTs) {
    const chargeSamples = maxChargeW !== null ? 1 : 0;
    const dischargeSamples = maxDischargeW !== null ? 1 : 0;
    return {
        hourKey,
        sampleCount: chargeSamples + dischargeSamples,
        chargeSamples,
        dischargeSamples,
        maxChargeW,
        maxDischargeW,
        lastSampleTs,
    };
}
async function backfillDensePowerSource(host, source, lookbackDays) {
    const baseDir = host.getAbsolutePath?.("learning/power_rollup");
    if (!baseDir) {
        return false;
    }
    let persist = await (0, persist_1.readPowerHourlyPersist)(baseDir);
    const existing = persist.sources[source.sourceKey];
    if (existing?.backfillDone && Object.keys(existing.hours).length >= MIN_BACKFILL_HOURS) {
        return false;
    }
    host.log.info(`Power-Rollup backfill: ${source.sourceKey} (${lookbackDays}d, ${source.stateId})…`);
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, source.stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const { points, meta } = (0, history_1.aggregatePowerPointsByHour)(rows, source.powerInvert);
    const hours = {};
    for (const point of points) {
        const hourKey = (0, hour_1.localHourKey)(point.ts);
        const existingHour = hours[hourKey] ?? {
            hourKey,
            sampleCount: 0,
            chargeSamples: 0,
            dischargeSamples: 0,
            maxChargeW: null,
            maxDischargeW: null,
            lastSampleTs: point.ts,
        };
        if (point.powerW > 0) {
            existingHour.maxChargeW =
                existingHour.maxChargeW === null
                    ? point.powerW
                    : Math.max(existingHour.maxChargeW, point.powerW);
            existingHour.chargeSamples = 1;
        }
        else {
            const magnitude = Math.abs(point.powerW);
            existingHour.maxDischargeW =
                existingHour.maxDischargeW === null
                    ? magnitude
                    : Math.max(existingHour.maxDischargeW, magnitude);
            existingHour.dischargeSamples = 1;
        }
        existingHour.sampleCount = existingHour.chargeSamples + existingHour.dischargeSamples;
        existingHour.lastSampleTs = Math.max(existingHour.lastSampleTs, point.ts);
        hours[hourKey] = existingHour;
    }
    const mergedHours = { ...(existing?.hours ?? {}) };
    for (const [key, rec] of Object.entries(hours)) {
        mergedHours[key] = (0, persist_1.mergeHourRecord)(mergedHours[key], rec);
    }
    persist = (0, persist_1.upsertSourcePersist)(persist, {
        sourceKey: source.sourceKey,
        stateId: source.stateId,
        powerInvert: source.powerInvert,
        backfillDone: true,
        hours: mergedHours,
    });
    await (0, persist_1.writePowerHourlyPersist)(baseDir, persist);
    host.log.info(`Power-Rollup backfill done: ${source.sourceKey} history_rows=${rows.length} hourly_chg=${meta.hourlyChargePoints} hourly_dis=${meta.hourlyDischargePoints} persisted_hours=${Object.keys(mergedHours).length}`);
    return true;
}
exports.backfillDensePowerSource = backfillDensePowerSource;
async function ensurePowerRollupBackfill(host, sources, lookbackDays) {
    for (const source of sources) {
        try {
            await backfillDensePowerSource(host, source, lookbackDays);
        }
        catch (e) {
            host.log.warn(`Power-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
exports.ensurePowerRollupBackfill = ensurePowerRollupBackfill;

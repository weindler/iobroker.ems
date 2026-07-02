"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePowerRollupBackfill = exports.backfillDensePowerSource = void 0;
const history_1 = require("../battery_runtime/history");
const constants_1 = require("../house_load/constants");
const history_query_1 = require("../history_query");
const state_util_1 = require("../../ems_light/state_util");
const hour_1 = require("./hour");
const persist_1 = require("./persist");
const MIN_BACKFILL_HOURS = 24;
function hourRecordFromBidirectional(hourKey, maxChargeW, maxDischargeW, lastSampleTs) {
    const chargeSamples = maxChargeW !== null ? 1 : 0;
    const dischargeSamples = maxDischargeW !== null ? 1 : 0;
    return {
        hourKey,
        sampleCount: chargeSamples + dischargeSamples,
        lastSampleTs,
        chargeSamples,
        dischargeSamples,
        maxChargeW,
        maxDischargeW,
    };
}
function hourRecordFromAvg(hourKey, avgPowerW, lastSampleTs) {
    return {
        hourKey,
        sampleCount: 1,
        lastSampleTs,
        chargeSamples: 0,
        dischargeSamples: 0,
        maxChargeW: null,
        maxDischargeW: null,
        sumPowerW: avgPowerW,
        avgPowerW,
    };
}
async function backfillBidirectional(host, source, lookbackDays) {
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, source.stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const { points, meta } = (0, history_1.aggregatePowerPointsByHour)(rows, source.powerInvert);
    const hours = {};
    for (const point of points) {
        const hourKey = (0, hour_1.localHourKey)(point.ts);
        const existingHour = hours[hourKey] ?? hourRecordFromBidirectional(hourKey, null, null, point.ts);
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
    return {
        hours,
        rows: rows.length,
        hourlyChg: meta.hourlyChargePoints,
        hourlyDis: meta.hourlyDischargePoints,
    };
}
async function backfillUnidirectionalAvg(host, source, lookbackDays) {
    const endMs = Date.now();
    const startMs = endMs - lookbackDays * constants_1.MS_PER_DAY;
    const aggregateRows = await (0, history_query_1.fetchHistoryRowsAggregated)(host, source.stateId, startMs, endMs, lookbackDays * 24 + 48, history_query_1.HISTORY_CHUNK_TIMEOUT_MS, "average", constants_1.MS_PER_HOUR);
    const hours = {};
    let hourlyAvg = 0;
    for (const row of aggregateRows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const raw = (0, state_util_1.asNum)(row?.val);
        if (ts === null || raw === null || raw < 0) {
            continue;
        }
        let watts = raw;
        if (source.powerUnit === "kW") {
            watts = raw * 1000;
        }
        else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
            watts = raw * 1000;
        }
        if (!Number.isFinite(watts) || watts < 0 || watts > 50_000) {
            continue;
        }
        const hourKey = (0, hour_1.localHourKey)(ts);
        const rec = hourRecordFromAvg(hourKey, Math.round(watts), ts);
        hours[hourKey] = (0, persist_1.mergeHourRecord)(hours[hourKey], rec, "unidirectional_avg");
        hourlyAvg++;
    }
    if (hourlyAvg < Math.min(lookbackDays, 7)) {
        const rawRows = await (0, history_query_1.fetchHistoryRowsLookback)(host, source.stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
        const byHour = new Map();
        for (const row of rawRows) {
            const ts = typeof row?.ts === "number" ? row.ts : null;
            const raw = (0, state_util_1.asNum)(row?.val);
            if (ts === null || raw === null || raw < 0) {
                continue;
            }
            let watts = raw;
            if (source.powerUnit === "kW") {
                watts = raw * 1000;
            }
            else if (Math.abs(raw) > 0 && Math.abs(raw) < 100) {
                watts = raw * 1000;
            }
            if (!Number.isFinite(watts) || watts < 0 || watts > 50_000) {
                continue;
            }
            const hourKey = (0, hour_1.localHourKey)(ts);
            const bucket = byHour.get(hourKey) ?? { sum: 0, count: 0, lastTs: ts };
            bucket.sum += watts;
            bucket.count += 1;
            bucket.lastTs = Math.max(bucket.lastTs, ts);
            byHour.set(hourKey, bucket);
        }
        if (byHour.size > hourlyAvg) {
            const fromRaw = {};
            for (const [hourKey, bucket] of byHour) {
                fromRaw[hourKey] = hourRecordFromAvg(hourKey, Math.round(bucket.sum / bucket.count), bucket.lastTs);
            }
            return { hours: fromRaw, rows: rawRows.length, hourlyAvg: byHour.size };
        }
    }
    return { hours, rows: aggregateRows.length, hourlyAvg };
}
async function backfillDensePowerSource(host, source) {
    const baseDir = host.getAbsolutePath?.("learning/power_rollup");
    if (!baseDir) {
        return false;
    }
    const lookbackDays = source.lookbackDays;
    let persist = await (0, persist_1.readPowerHourlyPersist)(baseDir);
    const existing = persist.sources[source.sourceKey];
    if (existing?.backfillDone && Object.keys(existing.hours).length >= MIN_BACKFILL_HOURS) {
        return false;
    }
    host.log.info(`Power-Rollup backfill: ${source.sourceKey} (${lookbackDays}d, ${source.stateId})…`);
    let mergedHours;
    if (source.rollupMode === "unidirectional_avg") {
        const result = await backfillUnidirectionalAvg(host, source, lookbackDays);
        mergedHours = { ...(existing?.hours ?? {}) };
        for (const [key, rec] of Object.entries(result.hours)) {
            mergedHours[key] = (0, persist_1.mergeHourRecord)(mergedHours[key], rec, "unidirectional_avg");
        }
        persist = (0, persist_1.upsertSourcePersist)(persist, {
            sourceKey: source.sourceKey,
            stateId: source.stateId,
            rollupMode: source.rollupMode,
            powerInvert: source.powerInvert,
            powerUnit: source.powerUnit,
            backfillDone: true,
            hours: mergedHours,
        });
        await (0, persist_1.writePowerHourlyPersist)(baseDir, persist);
        host.log.info(`Power-Rollup backfill done: ${source.sourceKey} history_rows=${result.rows} hourly_avg=${result.hourlyAvg} persisted_hours=${Object.keys(mergedHours).length}`);
        return true;
    }
    const result = await backfillBidirectional(host, source, lookbackDays);
    mergedHours = { ...(existing?.hours ?? {}) };
    for (const [key, rec] of Object.entries(result.hours)) {
        mergedHours[key] = (0, persist_1.mergeHourRecord)(mergedHours[key], rec, "bidirectional_max");
    }
    persist = (0, persist_1.upsertSourcePersist)(persist, {
        sourceKey: source.sourceKey,
        stateId: source.stateId,
        rollupMode: source.rollupMode,
        powerInvert: source.powerInvert,
        powerUnit: source.powerUnit,
        backfillDone: true,
        hours: mergedHours,
    });
    await (0, persist_1.writePowerHourlyPersist)(baseDir, persist);
    host.log.info(`Power-Rollup backfill done: ${source.sourceKey} history_rows=${result.rows} hourly_chg=${result.hourlyChg} hourly_dis=${result.hourlyDis} persisted_hours=${Object.keys(mergedHours).length}`);
    return true;
}
exports.backfillDensePowerSource = backfillDensePowerSource;
async function ensurePowerRollupBackfill(host, sources) {
    for (const source of sources) {
        try {
            await backfillDensePowerSource(host, source);
        }
        catch (e) {
            host.log.warn(`Power-Rollup backfill ${source.sourceKey}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
exports.ensurePowerRollupBackfill = ensurePowerRollupBackfill;

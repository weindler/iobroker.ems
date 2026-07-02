"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBidirectionalRollupSource = exports.rollupSourceToHouseLoadSamples = exports.rollupSourceToPowerPoints = exports.findSourceByStateId = void 0;
const constants_1 = require("../house_load/constants");
const time_1 = require("../house_load/time");
const constants_2 = require("../battery_runtime/constants");
const hour_1 = require("./hour");
const types_1 = require("./types");
function hourStartMs(ts) {
    return Math.floor(ts / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
}
function findSourceByStateId(persist, stateId) {
    for (const source of Object.values(persist.sources)) {
        if (source.stateId === stateId) {
            return source;
        }
    }
    return null;
}
exports.findSourceByStateId = findSourceByStateId;
function rollupSourceToPowerPoints(source, lookbackDays, nowMs = Date.now()) {
    const cutoff = nowMs - lookbackDays * constants_2.MS_PER_DAY;
    const points = [];
    let lastValidTs = null;
    let rawRows = 0;
    let rawChargeSamples = 0;
    let rawDischargeSamples = 0;
    let hourlyChargePoints = 0;
    let hourlyDischargePoints = 0;
    const hourKeys = Object.keys(source.hours).sort();
    for (const hourKey of hourKeys) {
        const rec = source.hours[hourKey];
        const ts = (0, hour_1.hourKeyToStartTs)(hourKey);
        if (ts < cutoff) {
            continue;
        }
        rawRows += rec.sampleCount;
        rawChargeSamples += rec.chargeSamples;
        rawDischargeSamples += rec.dischargeSamples;
        if (rec.maxChargeW !== null) {
            const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
            points.push({ ts: sampleTs, powerW: rec.maxChargeW });
            hourlyChargePoints++;
            if (lastValidTs === null || sampleTs > lastValidTs) {
                lastValidTs = sampleTs;
            }
        }
        if (rec.maxDischargeW !== null) {
            const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
            points.push({ ts: sampleTs, powerW: -rec.maxDischargeW });
            hourlyDischargePoints++;
            if (lastValidTs === null || sampleTs > lastValidTs) {
                lastValidTs = sampleTs;
            }
        }
    }
    points.sort((a, b) => a.ts - b.ts);
    return {
        points,
        lastValidTs,
        meta: {
            rawRows,
            normalizedRows: rawRows,
            rawChargeSamples,
            rawDischargeSamples,
            hourlyChargePoints,
            hourlyDischargePoints,
            powerInvert: source.powerInvert,
            powerInvertAuto: false,
            powerHistoryMode: "ems_rollup",
        },
    };
}
exports.rollupSourceToPowerPoints = rollupSourceToPowerPoints;
function rollupSourceToHouseLoadSamples(source, lookbackDays, nowMs = Date.now()) {
    const cutoff = nowMs - lookbackDays * constants_1.MS_PER_DAY;
    const samples = [];
    let lastValidTs = null;
    let rowsTotal = 0;
    let tsMin = null;
    let tsMax = null;
    const hourKeys = Object.keys(source.hours).sort();
    for (const hourKey of hourKeys) {
        const rec = source.hours[hourKey];
        const ts = (0, hour_1.hourKeyToStartTs)(hourKey);
        if (ts < cutoff) {
            continue;
        }
        const avg = rec.avgPowerW;
        if (avg === null || avg === undefined) {
            continue;
        }
        rowsTotal += rec.sampleCount;
        const sampleTs = rec.lastSampleTs > ts ? rec.lastSampleTs : ts;
        if (tsMin === null || sampleTs < tsMin)
            tsMin = sampleTs;
        if (tsMax === null || sampleTs > tsMax)
            tsMax = sampleTs;
        if (lastValidTs === null || sampleTs > lastValidTs) {
            lastValidTs = sampleTs;
        }
        const d = new Date(sampleTs);
        const ctx = (0, time_1.calendarContext)(d);
        samples.push({
            ts: sampleTs,
            hourStartMs: hourStartMs(sampleTs),
            dateKey: ctx.dateKey,
            hourOfDay: ctx.hourOfDay,
            segment: ctx.segment,
            season: ctx.season,
            weekday: ctx.weekday,
            dayType: ctx.dayType,
            powerW: avg,
        });
    }
    samples.sort((a, b) => a.hourStartMs - b.hourStartMs);
    let tsSpanHours = null;
    if (tsMin !== null && tsMax !== null && tsMax > tsMin) {
        tsSpanHours = Math.round((tsMax - tsMin) / constants_1.MS_PER_HOUR);
    }
    return {
        samples,
        lastValidTs,
        stats: {
            rowsTotal,
            validRows: samples.length,
            hourlySamples: samples.length,
            skippedInvalid: 0,
            skippedNegative: 0,
            tsSpanHours,
            historySource: "ems_rollup",
        },
    };
}
exports.rollupSourceToHouseLoadSamples = rollupSourceToHouseLoadSamples;
function isBidirectionalRollupSource(source) {
    return (0, types_1.effectiveRollupMode)(source) === "bidirectional_max";
}
exports.isBidirectionalRollupSource = isBidirectionalRollupSource;

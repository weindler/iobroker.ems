"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollupSourceToPowerPoints = exports.findSourceByStateId = void 0;
const constants_1 = require("../battery_runtime/constants");
const hour_1 = require("./hour");
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
    const cutoff = nowMs - lookbackDays * constants_1.MS_PER_DAY;
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

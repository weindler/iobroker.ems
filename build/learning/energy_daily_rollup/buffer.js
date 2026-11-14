"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAUSIBLE_DAY_KWH_MAX = void 0;
exports.isValidDayKwh = isValidDayKwh;
exports.emptyDayBuffer = emptyDayBuffer;
exports.ingestDailyKwhSample = ingestDailyKwhSample;
exports.bufferToDayRecord = bufferToDayRecord;
const day_1 = require("./day");
exports.PLAUSIBLE_DAY_KWH_MAX = 2000;
function isValidDayKwh(value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    return value > 0 && value <= exports.PLAUSIBLE_DAY_KWH_MAX;
}
function emptyDayBuffer(dateKey) {
    return {
        dateKey,
        kwh: 0,
        lastSampleTs: 0,
        sampleCount: 0,
    };
}
/** Monoton steigender Tageszähler: jeweils letzten gültigen Stand pro Tag behalten. */
function ingestDailyKwhSample(buffer, ts, rawKwh) {
    if (!isValidDayKwh(rawKwh)) {
        return buffer;
    }
    const dateKey = (0, day_1.localDateKey)(new Date(ts));
    let next = buffer;
    if (buffer.dateKey !== dateKey) {
        next = emptyDayBuffer(dateKey);
    }
    const rounded = Math.round(rawKwh * 1000) / 1000;
    if (next.sampleCount === 0 || ts >= next.lastSampleTs) {
        return {
            dateKey,
            kwh: rounded,
            lastSampleTs: ts,
            sampleCount: next.sampleCount + 1,
        };
    }
    return {
        ...next,
        sampleCount: next.sampleCount + 1,
    };
}
function bufferToDayRecord(buffer) {
    if (buffer.sampleCount === 0 || !isValidDayKwh(buffer.kwh)) {
        return null;
    }
    return {
        dateKey: buffer.dateKey,
        kwh: buffer.kwh,
        lastSampleTs: buffer.lastSampleTs,
        sampleCount: buffer.sampleCount,
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bufferToDayRecord = exports.ingestDailyKwhSample = exports.emptyDayBuffer = exports.isValidDayKwh = exports.PLAUSIBLE_DAY_KWH_MAX = void 0;
const day_1 = require("./day");
exports.PLAUSIBLE_DAY_KWH_MAX = 2000;
function isValidDayKwh(value) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    return value > 0 && value <= exports.PLAUSIBLE_DAY_KWH_MAX;
}
exports.isValidDayKwh = isValidDayKwh;
function emptyDayBuffer(dateKey) {
    return {
        dateKey,
        kwh: 0,
        lastSampleTs: 0,
        sampleCount: 0,
    };
}
exports.emptyDayBuffer = emptyDayBuffer;
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
exports.ingestDailyKwhSample = ingestDailyKwhSample;
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
exports.bufferToDayRecord = bufferToDayRecord;

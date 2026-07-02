"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bufferToHourRecord = exports.ingestPowerSample = exports.emptyHourBuffer = void 0;
const history_1 = require("../battery_runtime/history");
const hour_1 = require("./hour");
function emptyHourBuffer(hourKey) {
    return {
        hourKey,
        sampleCount: 0,
        chargeSamples: 0,
        dischargeSamples: 0,
        maxChargeW: null,
        maxDischargeW: null,
        lastSampleTs: 0,
    };
}
exports.emptyHourBuffer = emptyHourBuffer;
function ingestPowerSample(buffer, ts, rawW, powerInvert) {
    const hourKey = (0, hour_1.localHourKey)(ts);
    let next = buffer;
    if (buffer.hourKey !== hourKey) {
        next = emptyHourBuffer(hourKey);
    }
    const w = (0, history_1.normalizeBatteryPowerW)(rawW, powerInvert);
    if (w === null) {
        return next;
    }
    const updated = {
        ...next,
        sampleCount: next.sampleCount + 1,
        lastSampleTs: ts,
    };
    if (w > 0) {
        updated.chargeSamples += 1;
        updated.maxChargeW =
            updated.maxChargeW === null ? w : Math.max(updated.maxChargeW, w);
    }
    else {
        const magnitude = Math.abs(w);
        updated.dischargeSamples += 1;
        updated.maxDischargeW =
            updated.maxDischargeW === null ? magnitude : Math.max(updated.maxDischargeW, magnitude);
    }
    return updated;
}
exports.ingestPowerSample = ingestPowerSample;
function bufferToHourRecord(buffer) {
    if (buffer.sampleCount === 0) {
        return null;
    }
    return {
        hourKey: buffer.hourKey,
        sampleCount: buffer.sampleCount,
        chargeSamples: buffer.chargeSamples,
        dischargeSamples: buffer.dischargeSamples,
        maxChargeW: buffer.maxChargeW,
        maxDischargeW: buffer.maxDischargeW,
        lastSampleTs: buffer.lastSampleTs,
    };
}
exports.bufferToHourRecord = bufferToHourRecord;

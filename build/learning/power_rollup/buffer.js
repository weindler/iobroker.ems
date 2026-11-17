"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smallValuesMayBeKw = smallValuesMayBeKw;
exports.emptyHourBuffer = emptyHourBuffer;
exports.ingestBidirectionalSample = ingestBidirectionalSample;
exports.ingestUnidirectionalAvgSample = ingestUnidirectionalAvgSample;
exports.ingestRollupSample = ingestRollupSample;
exports.bufferToHourRecord = bufferToHourRecord;
const history_1 = require("../battery_runtime/history");
const constants_1 = require("../house_load/constants");
const hour_1 = require("./hour");
/**
 * Kleine Rohwerte (< 100) gelten bei Quellen ohne verlässliche Einheit als kW (z. B. 3,5 statt 3500).
 * Das gilt nicht für PV und Wallbox: Dort sind Werte unter 100 W echt (Dämmerung, Standby) und
 * würden sonst mit 1000 multipliziert (2,4 W → 2400 W).
 */
function smallValuesMayBeKw(role) {
    return role !== "pv_ac_power_w" && role !== "charge_power_w";
}
function normalizeConsumptionW(raw, unit, smallAsKw = true) {
    if (!Number.isFinite(raw)) {
        return null;
    }
    let watts = raw;
    if (unit === "kW") {
        watts = raw * 1000;
    }
    else if (smallAsKw && Math.abs(raw) > 0 && Math.abs(raw) < 100) {
        watts = raw * 1000;
    }
    if (watts < constants_1.PLAUSIBLE_W_MIN || watts > constants_1.PLAUSIBLE_W_MAX) {
        return null;
    }
    return Math.round(watts);
}
function emptyHourBuffer(hourKey, rollupMode) {
    return {
        hourKey,
        rollupMode,
        sampleCount: 0,
        chargeSamples: 0,
        dischargeSamples: 0,
        maxChargeW: null,
        maxDischargeW: null,
        sumPowerW: 0,
        lastSampleTs: 0,
    };
}
function ingestBidirectionalSample(buffer, ts, rawW, powerInvert) {
    const hourKey = (0, hour_1.localHourKey)(ts);
    let next = buffer;
    if (buffer.hourKey !== hourKey) {
        next = emptyHourBuffer(hourKey, "bidirectional_max");
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
function ingestUnidirectionalAvgSample(buffer, ts, rawW, powerUnit, smallAsKw = true) {
    const hourKey = (0, hour_1.localHourKey)(ts);
    let next = buffer;
    if (buffer.hourKey !== hourKey) {
        next = emptyHourBuffer(hourKey, "unidirectional_avg");
    }
    const w = normalizeConsumptionW(rawW, powerUnit, smallAsKw);
    if (w === null) {
        return next;
    }
    return {
        ...next,
        sampleCount: next.sampleCount + 1,
        sumPowerW: next.sumPowerW + w,
        lastSampleTs: ts,
    };
}
function ingestRollupSample(buffer, ts, rawW, rollupMode, powerInvert, powerUnit, smallAsKw = true) {
    if (rollupMode === "unidirectional_avg") {
        return ingestUnidirectionalAvgSample(buffer, ts, rawW, powerUnit, smallAsKw);
    }
    return ingestBidirectionalSample(buffer, ts, rawW, powerInvert);
}
function bufferToHourRecord(buffer) {
    if (buffer.sampleCount === 0) {
        return null;
    }
    if (buffer.rollupMode === "unidirectional_avg") {
        const avgPowerW = buffer.sampleCount > 0 ? Math.round(buffer.sumPowerW / buffer.sampleCount) : null;
        return {
            hourKey: buffer.hourKey,
            sampleCount: buffer.sampleCount,
            lastSampleTs: buffer.lastSampleTs,
            chargeSamples: 0,
            dischargeSamples: 0,
            maxChargeW: null,
            maxDischargeW: null,
            sumPowerW: buffer.sumPowerW,
            avgPowerW,
        };
    }
    return {
        hourKey: buffer.hourKey,
        sampleCount: buffer.sampleCount,
        lastSampleTs: buffer.lastSampleTs,
        chargeSamples: buffer.chargeSamples,
        dischargeSamples: buffer.dischargeSamples,
        maxChargeW: buffer.maxChargeW,
        maxDischargeW: buffer.maxDischargeW,
    };
}

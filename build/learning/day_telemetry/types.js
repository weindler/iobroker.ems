"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyDayTelemetryStore = exports.emptyDayRecord = exports.emptyBuckets = void 0;
const constants_1 = require("./constants");
function emptyBuckets(slotCount) {
    const n = (fill = null) => Array.from({ length: slotCount }, () => fill);
    const nNum = () => Array.from({ length: slotCount }, () => 0);
    const nStr = () => Array.from({ length: slotCount }, () => null);
    return {
        pvKwh: n(),
        houseTotalKwh: n(),
        gridImportKwh: n(),
        gridExportKwh: n(),
        priceCtPerKwh: n(),
        batterySocEndPct: n(),
        batteryChargedKwh: n(),
        batteryDischargedKwh: n(),
        evChargedKwh: n(),
        evSocEndPct: n(),
        immersionKwh: n(),
        immersionRuntimeSec: n(),
        boilerTempEndC: n(),
        climateKwh: n(),
        climateElecSharedKwh: n(),
        otherMeasuredConsumersKwh: n(),
        plannedConsumersRef: n(),
        snapshotIdRef: nStr(),
        qualityMask: nNum(),
    };
}
exports.emptyBuckets = emptyBuckets;
function emptyDayRecord(dateKey, timezone, startMs, endMs, slotCount) {
    return {
        dateKey,
        timezone,
        slotWidthMs: constants_1.DAY_TELEMETRY_SLOT_MS,
        slotCount,
        startMs,
        endMs,
        complete: false,
        buckets: emptyBuckets(slotCount),
        plannedConsumers: [],
        forecastSnapshots: [],
        replanEvents: [],
        climateRunSegments: [],
        statusEvents: [],
    };
}
exports.emptyDayRecord = emptyDayRecord;
function emptyDayTelemetryStore() {
    return {
        module: constants_1.DAY_TELEMETRY_MODULE,
        schemaVersion: constants_1.DAY_TELEMETRY_SCHEMA,
        updatedAtIso: new Date().toISOString(),
        days: {},
    };
}
exports.emptyDayTelemetryStore = emptyDayTelemetryStore;

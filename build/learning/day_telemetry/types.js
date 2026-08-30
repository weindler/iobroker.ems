"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noteSampleTimestamps = exports.refreshDayCoverage = exports.emptyDayTelemetryStore = exports.emptyDayRecord = exports.emptyBuckets = void 0;
const constants_1 = require("./constants");
function emptyBuckets(slotCount) {
    const n = () => Array.from({ length: slotCount }, () => null);
    const nMask = () => Array.from({ length: slotCount }, () => null);
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
        qualityMask: nMask(),
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
        firstSampleMs: null,
        firstSampleIso: null,
        lastSampleMs: null,
        lastSampleIso: null,
        observedSlotCount: 0,
        coveragePct: 0,
        evaluable: false,
        buckets: emptyBuckets(slotCount),
        plannedConsumers: [],
        forecastSnapshots: [],
        forecastRevisions: [],
        replanEvents: [],
        climateRunSegments: [],
        immersionRunSegments: [],
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
/** Coverage-Metadaten aus qualityMask neu berechnen (keine erfundenen Messwerte). */
function refreshDayCoverage(day) {
    let observed = 0;
    for (const m of day.buckets.qualityMask) {
        if (m !== null)
            observed++;
    }
    day.observedSlotCount = observed;
    day.coveragePct =
        day.slotCount > 0 ? Math.round((observed / day.slotCount) * 1000) / 10 : 0;
    day.evaluable = day.coveragePct >= constants_1.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT;
}
exports.refreshDayCoverage = refreshDayCoverage;
function noteSampleTimestamps(day, nowMs) {
    const iso = new Date(nowMs).toISOString();
    if (day.firstSampleMs == null) {
        day.firstSampleMs = nowMs;
        day.firstSampleIso = iso;
    }
    day.lastSampleMs = nowMs;
    day.lastSampleIso = iso;
}
exports.noteSampleTimestamps = noteSampleTimestamps;

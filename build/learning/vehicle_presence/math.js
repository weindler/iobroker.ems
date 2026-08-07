"use strict";
/**
 * Fahrzeug-Presence Learning — Wochentag × 15-Min-Bucket × Fahrzeugprofil.
 * Observation = unabhängiger historischer Tag, nicht Runtime-Tick.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bucketStatsForTest = exports.seedBucket = exports.observeConnected = exports.predictAt = exports.predictFromCounts = exports.confidenceFromSamples = exports.availabilityRatio = exports.localBucketAt = exports.bucketKey = exports.bucketIndexFromLocal = void 0;
const time_1 = require("../../operator/time");
const constants_1 = require("./constants");
const types_1 = require("./types");
function zonedHourMinuteWeekday(ms, timezone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone.trim() || "UTC",
        hour12: false,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(ms));
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const map = {
        Mon: 0,
        Tue: 1,
        Wed: 2,
        Thu: 3,
        Fri: 4,
        Sat: 5,
        Sun: 6,
    };
    return { hour, minute, weekday: map[wd] ?? 0 };
}
function bucketIndexFromLocal(hour, minute) {
    const idx = Math.floor((hour * 60 + minute) / constants_1.BUCKET_MINUTES);
    return Math.max(0, Math.min(constants_1.BUCKETS_PER_DAY - 1, idx));
}
exports.bucketIndexFromLocal = bucketIndexFromLocal;
function bucketKey(weekday, bucketIndex) {
    return `${weekday}:${bucketIndex}`;
}
exports.bucketKey = bucketKey;
function localBucketAt(ms, timezone) {
    const { hour, minute, weekday } = zonedHourMinuteWeekday(ms, timezone);
    const bucketIndex = bucketIndexFromLocal(hour, minute);
    return {
        weekday,
        bucketIndex,
        key: bucketKey(weekday, bucketIndex),
        dateKey: (0, time_1.localDateKeyInTimezone)(new Date(ms), timezone),
    };
}
exports.localBucketAt = localBucketAt;
function availabilityRatio(connectedCount, observedCount) {
    if (!(observedCount > 0))
        return null;
    return connectedCount / observedCount;
}
exports.availabilityRatio = availabilityRatio;
function confidenceFromSamples(observedCount) {
    if (observedCount < constants_1.MIN_OBSERVATIONS_FOR_PREDICTION)
        return null;
    if (observedCount >= constants_1.CONFIDENCE_TARGET_SAMPLES)
        return constants_1.CONFIDENCE_AT_TARGET_PCT;
    const t = (observedCount - constants_1.MIN_OBSERVATIONS_FOR_PREDICTION) /
        (constants_1.CONFIDENCE_TARGET_SAMPLES - constants_1.MIN_OBSERVATIONS_FOR_PREDICTION);
    return Math.round(constants_1.CONFIDENCE_AT_MIN_PCT + t * (constants_1.CONFIDENCE_AT_TARGET_PCT - constants_1.CONFIDENCE_AT_MIN_PCT));
}
exports.confidenceFromSamples = confidenceFromSamples;
function predictFromCounts(connectedCount, observedCount) {
    if (observedCount < constants_1.MIN_OBSERVATIONS_FOR_PREDICTION) {
        return {
            status: "unknown",
            confidencePct: null,
            observedCount,
            availabilityRatio: availabilityRatio(connectedCount, observedCount),
            source: "unknown",
        };
    }
    const ratio = availabilityRatio(connectedCount, observedCount);
    const confidencePct = confidenceFromSamples(observedCount);
    if (ratio >= constants_1.PREDICT_AVAILABLE_RATIO) {
        return {
            status: "available",
            confidencePct,
            observedCount,
            availabilityRatio: ratio,
            source: "predicted",
        };
    }
    if (ratio <= constants_1.PREDICT_UNAVAILABLE_RATIO) {
        return {
            status: "unavailable",
            confidencePct,
            observedCount,
            availabilityRatio: ratio,
            source: "predicted",
        };
    }
    return {
        status: "unknown",
        confidencePct,
        observedCount,
        availabilityRatio: ratio,
        source: "unknown",
    };
}
exports.predictFromCounts = predictFromCounts;
function profileOf(store, vehicleKey) {
    return store.profiles[vehicleKey] ?? null;
}
function predictAt(store, atMs, timezone, vehicleKey) {
    const unknown = {
        status: "unknown",
        confidencePct: null,
        observedCount: 0,
        availabilityRatio: null,
        source: "unknown",
    };
    if (!store || !vehicleKey)
        return unknown;
    const profile = profileOf(store, vehicleKey);
    if (!profile)
        return unknown;
    const { key } = localBucketAt(atMs, timezone);
    const b = profile.buckets[key];
    if (!b)
        return unknown;
    return predictFromCounts(b.connectedCount, b.observedCount);
}
exports.predictAt = predictAt;
/**
 * Unabhängige Observation: max. 1 pro (vehicleKey × lokales Datum × Wochentag × Bucket).
 * Wiederholte Runtime-Ticks im selben Fenster erhöhen observedCount nicht.
 * Connect/Disconnect im selben Fenster: letzter Zustand aktualisiert connectedCount ohne +1 Sample.
 *
 * Ohne sichere vehicleKey: kein Learning (Store unverändert).
 */
function observeConnected(store, atMs, timezone, connected, vehicleKey) {
    const base = store ?? (0, types_1.emptyVehiclePresenceStore)(new Date(atMs).toISOString());
    if (!vehicleKey || !vehicleKey.trim()) {
        return base;
    }
    const keyId = vehicleKey.trim();
    const { weekday, bucketIndex, key, dateKey } = localBucketAt(atMs, timezone);
    const profile = base.profiles[keyId] ?? {
        vehicleKey: keyId,
        buckets: {},
    };
    const prev = profile.buckets[key] ?? {
        weekday,
        bucketIndex,
        connectedCount: 0,
        observedCount: 0,
        sampledDates: {},
    };
    const sampledDates = { ...(prev.sampledDates ?? {}) };
    if (Object.prototype.hasOwnProperty.call(sampledDates, dateKey)) {
        const prevConnected = sampledDates[dateKey] === true;
        if (prevConnected === connected) {
            return base; // reiner Tick-Repeat — keine Änderung
        }
        // Letzter Zustand im selben Tages-Bucket: Counts anpassen, observedCount bleibt
        let connectedCount = prev.connectedCount;
        if (prevConnected && !connected)
            connectedCount = Math.max(0, connectedCount - 1);
        if (!prevConnected && connected)
            connectedCount = connectedCount + 1;
        sampledDates[dateKey] = connected;
        const nextBucket = {
            ...prev,
            connectedCount,
            sampledDates,
        };
        return {
            ...base,
            schemaVersion: 2,
            updatedAtIso: new Date(atMs).toISOString(),
            profiles: {
                ...base.profiles,
                [keyId]: {
                    ...profile,
                    buckets: { ...profile.buckets, [key]: nextBucket },
                },
            },
        };
    }
    sampledDates[dateKey] = connected;
    const nextBucket = {
        weekday,
        bucketIndex,
        connectedCount: prev.connectedCount + (connected ? 1 : 0),
        observedCount: prev.observedCount + 1,
        sampledDates,
    };
    return {
        ...base,
        schemaVersion: 2,
        updatedAtIso: new Date(atMs).toISOString(),
        profiles: {
            ...base.profiles,
            [keyId]: {
                ...profile,
                buckets: { ...profile.buckets, [key]: nextBucket },
            },
        },
    };
}
exports.observeConnected = observeConnected;
/** Test-Hilfe: unabhängige Tages-Samples für ein Profil/Bucket setzen. */
function seedBucket(store, weekday, bucketIndex, connectedCount, observedCount, vehicleKey = "test_vehicle") {
    const key = bucketKey(weekday, bucketIndex);
    const sampledDates = {};
    for (let i = 0; i < observedCount; i++) {
        // Synthetische Datumsschlüssel — nur für Tests
        sampledDates[`seed-${weekday}-${bucketIndex}-${i}`] = i < connectedCount;
    }
    const profile = store.profiles[vehicleKey] ?? { vehicleKey, buckets: {} };
    return {
        ...store,
        schemaVersion: 2,
        profiles: {
            ...store.profiles,
            [vehicleKey]: {
                ...profile,
                buckets: {
                    ...profile.buckets,
                    [key]: {
                        weekday,
                        bucketIndex,
                        connectedCount,
                        observedCount,
                        sampledDates,
                    },
                },
            },
        },
    };
}
exports.seedBucket = seedBucket;
function bucketStatsForTest(store, vehicleKey, weekday, bucketIndex) {
    return store.profiles[vehicleKey]?.buckets[bucketKey(weekday, bucketIndex)] ?? null;
}
exports.bucketStatsForTest = bucketStatsForTest;

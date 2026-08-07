/**
 * Fahrzeug-Presence Learning — Wochentag × 15-Min-Bucket × Fahrzeugprofil.
 * Observation = unabhängiger historischer Tag, nicht Runtime-Tick.
 */

import { localDateKeyInTimezone } from "../../operator/time";
import {
	BUCKET_MINUTES,
	BUCKETS_PER_DAY,
	CONFIDENCE_AT_MIN_PCT,
	CONFIDENCE_AT_TARGET_PCT,
	CONFIDENCE_TARGET_SAMPLES,
	MIN_OBSERVATIONS_FOR_PREDICTION,
	PREDICT_AVAILABLE_RATIO,
	PREDICT_UNAVAILABLE_RATIO,
} from "./constants";
import {
	emptyVehiclePresenceStore,
	type VehiclePresenceBucketStats,
	type VehiclePresenceLearningStore,
	type VehiclePresencePrediction,
	type VehiclePresenceProfileStore,
} from "./types";

function zonedHourMinuteWeekday(ms: number, timezone: string): {
	hour: number;
	minute: number;
	weekday: number;
} {
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
	const map: Record<string, number> = {
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

export function bucketIndexFromLocal(hour: number, minute: number): number {
	const idx = Math.floor((hour * 60 + minute) / BUCKET_MINUTES);
	return Math.max(0, Math.min(BUCKETS_PER_DAY - 1, idx));
}

export function bucketKey(weekday: number, bucketIndex: number): string {
	return `${weekday}:${bucketIndex}`;
}

export function localBucketAt(
	ms: number,
	timezone: string,
): { weekday: number; bucketIndex: number; key: string; dateKey: string } {
	const { hour, minute, weekday } = zonedHourMinuteWeekday(ms, timezone);
	const bucketIndex = bucketIndexFromLocal(hour, minute);
	return {
		weekday,
		bucketIndex,
		key: bucketKey(weekday, bucketIndex),
		dateKey: localDateKeyInTimezone(new Date(ms), timezone),
	};
}

export function availabilityRatio(connectedCount: number, observedCount: number): number | null {
	if (!(observedCount > 0)) return null;
	return connectedCount / observedCount;
}

export function confidenceFromSamples(observedCount: number): number | null {
	if (observedCount < MIN_OBSERVATIONS_FOR_PREDICTION) return null;
	if (observedCount >= CONFIDENCE_TARGET_SAMPLES) return CONFIDENCE_AT_TARGET_PCT;
	const t =
		(observedCount - MIN_OBSERVATIONS_FOR_PREDICTION) /
		(CONFIDENCE_TARGET_SAMPLES - MIN_OBSERVATIONS_FOR_PREDICTION);
	return Math.round(CONFIDENCE_AT_MIN_PCT + t * (CONFIDENCE_AT_TARGET_PCT - CONFIDENCE_AT_MIN_PCT));
}

export function predictFromCounts(
	connectedCount: number,
	observedCount: number,
): VehiclePresencePrediction {
	if (observedCount < MIN_OBSERVATIONS_FOR_PREDICTION) {
		return {
			status: "unknown",
			confidencePct: null,
			observedCount,
			availabilityRatio: availabilityRatio(connectedCount, observedCount),
			source: "unknown",
		};
	}
	const ratio = availabilityRatio(connectedCount, observedCount)!;
	const confidencePct = confidenceFromSamples(observedCount);
	if (ratio >= PREDICT_AVAILABLE_RATIO) {
		return {
			status: "available",
			confidencePct,
			observedCount,
			availabilityRatio: ratio,
			source: "predicted",
		};
	}
	if (ratio <= PREDICT_UNAVAILABLE_RATIO) {
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

function profileOf(
	store: VehiclePresenceLearningStore,
	vehicleKey: string,
): VehiclePresenceProfileStore | null {
	return store.profiles[vehicleKey] ?? null;
}

export function predictAt(
	store: VehiclePresenceLearningStore | null | undefined,
	atMs: number,
	timezone: string,
	vehicleKey: string | null | undefined,
): VehiclePresencePrediction {
	const unknown: VehiclePresencePrediction = {
		status: "unknown",
		confidencePct: null,
		observedCount: 0,
		availabilityRatio: null,
		source: "unknown",
	};
	if (!store || !vehicleKey) return unknown;
	const profile = profileOf(store, vehicleKey);
	if (!profile) return unknown;
	const { key } = localBucketAt(atMs, timezone);
	const b = profile.buckets[key];
	if (!b) return unknown;
	return predictFromCounts(b.connectedCount, b.observedCount);
}

/**
 * Unabhängige Observation: max. 1 pro (vehicleKey × lokales Datum × Wochentag × Bucket).
 * Wiederholte Runtime-Ticks im selben Fenster erhöhen observedCount nicht.
 * Connect/Disconnect im selben Fenster: letzter Zustand aktualisiert connectedCount ohne +1 Sample.
 *
 * Ohne sichere vehicleKey: kein Learning (Store unverändert).
 */
export function observeConnected(
	store: VehiclePresenceLearningStore | null | undefined,
	atMs: number,
	timezone: string,
	connected: boolean,
	vehicleKey: string | null | undefined,
): VehiclePresenceLearningStore {
	const base = store ?? emptyVehiclePresenceStore(new Date(atMs).toISOString());
	if (!vehicleKey || !vehicleKey.trim()) {
		return base;
	}
	const keyId = vehicleKey.trim();
	const { weekday, bucketIndex, key, dateKey } = localBucketAt(atMs, timezone);
	const profile: VehiclePresenceProfileStore = base.profiles[keyId] ?? {
		vehicleKey: keyId,
		buckets: {},
	};
	const prev: VehiclePresenceBucketStats = profile.buckets[key] ?? {
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
		if (prevConnected && !connected) connectedCount = Math.max(0, connectedCount - 1);
		if (!prevConnected && connected) connectedCount = connectedCount + 1;
		sampledDates[dateKey] = connected;
		const nextBucket: VehiclePresenceBucketStats = {
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
	const nextBucket: VehiclePresenceBucketStats = {
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

/** Test-Hilfe: unabhängige Tages-Samples für ein Profil/Bucket setzen. */
export function seedBucket(
	store: VehiclePresenceLearningStore,
	weekday: number,
	bucketIndex: number,
	connectedCount: number,
	observedCount: number,
	vehicleKey = "test_vehicle",
): VehiclePresenceLearningStore {
	const key = bucketKey(weekday, bucketIndex);
	const sampledDates: Record<string, boolean> = {};
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

export function bucketStatsForTest(
	store: VehiclePresenceLearningStore,
	vehicleKey: string,
	weekday: number,
	bucketIndex: number,
): VehiclePresenceBucketStats | null {
	return store.profiles[vehicleKey]?.buckets[bucketKey(weekday, bucketIndex)] ?? null;
}

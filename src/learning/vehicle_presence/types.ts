import { MODULE_TAG } from "./constants";

export type VehiclePresenceBucketStats = {
	/** 0=Montag … 6=Sonntag (ISO-ähnlich). */
	weekday: number;
	/** 0 … BUCKETS_PER_DAY-1. */
	bucketIndex: number;
	connectedCount: number;
	/** Unabhängige historische Samples (max. 1 pro lokalem Datum). */
	observedCount: number;
	/**
	 * Bereits gezählte lokale Datumsschlüssel → letzter belastbarer connected-Zustand.
	 * Verhindert Tick-Inflation innerhalb desselben Tages/Buckets.
	 */
	sampledDates: Record<string, boolean>;
};

export type VehiclePresenceProfileStore = {
	vehicleKey: string;
	buckets: Record<string, VehiclePresenceBucketStats>;
};

export type VehiclePresenceLearningStore = {
	module: typeof MODULE_TAG;
	/** 2 = profilisoliert + Datum-Dedup; v1 flat buckets werden verworfen. */
	schemaVersion: 2;
	updatedAtIso: string;
	profiles: Record<string, VehiclePresenceProfileStore>;
};

export type VehiclePresencePrediction = {
	status: "available" | "unavailable" | "unknown";
	confidencePct: number | null;
	observedCount: number;
	availabilityRatio: number | null;
	source: "predicted" | "unknown";
};

export function emptyVehiclePresenceStore(nowIso = new Date().toISOString()): VehiclePresenceLearningStore {
	return {
		module: MODULE_TAG,
		schemaVersion: 2,
		updatedAtIso: nowIso,
		profiles: {},
	};
}

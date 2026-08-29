import {
	DAY_TELEMETRY_MODULE,
	DAY_TELEMETRY_SCHEMA,
	DAY_TELEMETRY_SLOT_MS,
} from "./constants";

/** Kompakte Frozen Allocation pro Slot-Eintrag. */
export type FrozenPlannedConsumer = {
	consumerId: string;
	kind: string;
	energyKwh: number | null;
};

/** Kompakter Planner-Wissens-Snapshot (kein voller UnifiedDayPlannerInput-Dump). */
export type PlannerKnowledgeSnapshot = {
	id: string;
	tsIso: string;
	date: string;
	timezone: string;
	globalMode: string;
	contributionRevision: number | null;
	/** Erwartete PV-Tagesenergie zum Entscheidungszeitpunkt. */
	pvExpectedDayKwh: number | null;
	/** Erwartete Hauslast-Tagesenergie. */
	houseLoadExpectedDayKwh: number | null;
	/** Batterie-SOC zum Entscheidungszeitpunkt. */
	batterySocPct: number | null;
	batteryCapacityKwh: number | null;
	batteryNightReserveKwh: number | null;
	/** Preis-Slots: [startMs, ct/kWh] — kompakt. */
	priceSlots: Array<[number, number]>;
	/** PV-Slot-Energien: [startMs, kWh]. */
	pvSlotKwh: Array<[number, number]>;
	/** Wallbox-Zielenergie / Deadline / Presence-Digest. */
	wallboxRequiredEnergyKwh: number | null;
	wallboxDeadlineIso: string | null;
	wallboxConnected: boolean | null;
	wallboxPresenceDigest: string | null;
	/** Thermal. */
	thermalBufferTempC: number | null;
	thermalEmptyAtIso: string | null;
	thermalHeadroomKwh: number | null;
	/** Klima: Unit-IDs + shared groups + mandatory flags. */
	climateUnits: Array<{
		consumerId: string;
		sharedPowerGroupId: string | null;
		mandatory: boolean;
		mode: string | null;
	}>;
};

export type DayTelemetryReplanEvent = {
	tsIso: string;
	generation: number;
	planId: string;
	reasonCodes: string[];
	affectedSlotFrom: number;
	affectedSlotTo: number;
	snapshotId: string;
};

export type ClimateRunSegment = {
	startTs: number;
	endTs: number;
	/** null = unknown — nicht unter "default" zusammenfassen. */
	sharedPowerGroupId: string | null;
	mode: string;
	activeUnitCombination: string;
	energyKwh: number;
	runtimeSec: number;
	valid: boolean;
	rejectReason: string | null;
};

export type DayTelemetryStatusEvent = {
	tsIso: string;
	kind: string;
	detail: string;
};

/**
 * Struct-of-Arrays Slot-Buckets.
 * Länge = slotCount (92/96/100). Null = missing, nie erfundene 0.
 */
export type DayTelemetryBuckets = {
	pvKwh: Array<number | null>;
	houseTotalKwh: Array<number | null>;
	gridImportKwh: Array<number | null>;
	gridExportKwh: Array<number | null>;
	priceCtPerKwh: Array<number | null>;
	batterySocEndPct: Array<number | null>;
	batteryChargedKwh: Array<number | null>;
	batteryDischargedKwh: Array<number | null>;
	evChargedKwh: Array<number | null>;
	evSocEndPct: Array<number | null>;
	immersionKwh: Array<number | null>;
	immersionRuntimeSec: Array<number | null>;
	boilerTempEndC: Array<number | null>;
	climateKwh: Array<number | null>;
	climateElecSharedKwh: Array<number | null>;
	otherMeasuredConsumersKwh: Array<number | null>;
	/** Index in plannedConsumers[] — null wenn noch nicht eingefroren. */
	plannedConsumersRef: Array<number | null>;
	/** Snapshot-ID zum Slotstart (string-Hash). */
	snapshotIdRef: Array<string | null>;
	/** Bitmask 2 Bit × 10 Domänen. */
	qualityMask: number[];
};

export type DayTelemetryDayRecord = {
	dateKey: string;
	timezone: string;
	slotWidthMs: typeof DAY_TELEMETRY_SLOT_MS;
	slotCount: number;
	/** Absoluter UTC-Start von Slot 0. */
	startMs: number;
	/** Absoluter UTC-Ende des Tages (Slot slotCount). */
	endMs: number;
	complete: boolean;
	buckets: DayTelemetryBuckets;
	plannedConsumers: FrozenPlannedConsumer[][];
	forecastSnapshots: PlannerKnowledgeSnapshot[];
	replanEvents: DayTelemetryReplanEvent[];
	climateRunSegments: ClimateRunSegment[];
	statusEvents: DayTelemetryStatusEvent[];
};

export type DayTelemetryStore = {
	module: typeof DAY_TELEMETRY_MODULE;
	schemaVersion: typeof DAY_TELEMETRY_SCHEMA;
	updatedAtIso: string;
	days: Record<string, DayTelemetryDayRecord>;
};

export function emptyBuckets(slotCount: number): DayTelemetryBuckets {
	const n = (fill: null | number = null): Array<number | null> =>
		Array.from({ length: slotCount }, () => fill);
	const nNum = (): number[] => Array.from({ length: slotCount }, () => 0);
	const nStr = (): Array<string | null> => Array.from({ length: slotCount }, () => null);
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

export function emptyDayRecord(
	dateKey: string,
	timezone: string,
	startMs: number,
	endMs: number,
	slotCount: number,
): DayTelemetryDayRecord {
	return {
		dateKey,
		timezone,
		slotWidthMs: DAY_TELEMETRY_SLOT_MS,
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

export function emptyDayTelemetryStore(): DayTelemetryStore {
	return {
		module: DAY_TELEMETRY_MODULE,
		schemaVersion: DAY_TELEMETRY_SCHEMA,
		updatedAtIso: new Date().toISOString(),
		days: {},
	};
}

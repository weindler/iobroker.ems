import {
	DAY_TELEMETRY_MODULE,
	DAY_TELEMETRY_SCHEMA,
	DAY_TELEMETRY_SLOT_MS,
	DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT,
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
	pvExpectedDayKwh: number | null;
	houseLoadExpectedDayKwh: number | null;
	batterySocPct: number | null;
	batteryCapacityKwh: number | null;
	batteryNightReserveKwh: number | null;
	priceSlots: Array<[number, number]>;
	pvSlotKwh: Array<[number, number]>;
	wallboxRequiredEnergyKwh: number | null;
	wallboxDeadlineIso: string | null;
	wallboxConnected: boolean | null;
	wallboxPresenceDigest: string | null;
	thermalBufferTempC: number | null;
	thermalEmptyAtIso: string | null;
	thermalHeadroomKwh: number | null;
	climateUnits: Array<{
		consumerId: string;
		sharedPowerGroupId: string | null;
		mandatory: boolean;
		mode: string | null;
		/**
		 * Additiv (Block A, Abnahme-Korrektur): zum Entscheidungszeitpunkt gültige Hard-Off-Deadline
		 * dieser Unit — 1:1 aus `UnifiedClimateUnitInput.hardStopMs` (dieselbe Deadline, die der
		 * Unified Planner für die Allokation nutzt, siehe score_allocate.ts `deadlineMs`), keine neue
		 * Berechnung. `null` wenn zu diesem Zeitpunkt kein Hard-Off konfiguriert/berechenbar war.
		 */
		hardOffAtIso: string | null;
		/**
		 * Additiv (Block A, Abnahme-Korrektur #2b): zum Entscheidungszeitpunkt bekannte Rohgrößen für
		 * die bestehende Urgency-Formel (`coolingDemandUrgency01`/`dehumidifyDemandUrgency01` in
		 * hard_off_worth_it.ts) — 1:1 aus `UnifiedClimateUnitInput`, keine neue Berechnung. Optional:
		 * ältere, vor dieser Erweiterung geschriebene Snapshots haben diese Felder nicht (undefined),
		 * das ist von `null` (Wert war bekannt und leer) zu unterscheiden — beides bedeutet für die
		 * Auswertung "nicht belastbar bekannt".
		 */
		roomTempC?: number | null;
		targetTempC?: number | null;
		roomHumidityPct?: number | null;
		maxHumidityPct?: number | null;
	}>;
	/**
	 * Additiv (Block A): tatsächlich verwendeter Wallbox-Ziel-Kontext zum Snapshot-Zeitpunkt.
	 * Werte kommen unverändert aus UnifiedWallboxInput — keine neue Berechnung, kein Control-Effekt.
	 */
	wallboxTargetSocPct: number | null;
	wallboxMinimumDepartureSocPct: number | null;
	wallboxEnergyGoalHard: boolean | null;
	wallboxManagementMode: string | null;
	/**
	 * Additiv (Block A): tatsächlich verwendeter Battery-Discharge-/Reserve-Kontext zum
	 * Snapshot-Zeitpunkt — Werte kommen 1:1 aus dem bestehenden Decision-Pfad
	 * (`resolveBatteryDischargeAuthorization` + `resolveCentralBatteryReserveTarget` +
	 * `battery_hold_active`), keine neue Logik, kein Control-Effekt. `null` wenn der
	 * Aufrufer den Kontext nicht mitgegeben hat (z. B. ältere Tests).
	 */
	batteryDecision: {
		action: "hold" | "discharge_allowed" | "discharge_blocked";
		dischargeAllowed: boolean;
		requiredSocAtPvEndPct: number | null;
		holdActive: boolean;
		reasonCode:
			| "battery_hold_active"
			| "price_and_reserve_ok"
			| "reserve_unknown"
			| "price_blocked"
			| "soc_unknown"
			| "soc_below_reserve";
	} | null;
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
	sharedPowerGroupId: string | null;
	mode: string;
	activeUnitCombination: string;
	energyKwh: number;
	runtimeSec: number;
	valid: boolean;
	rejectReason: string | null;
};

/**
 * Additiv (Block A): echte Heizstab-Lauf-Segmente analog ClimateRunSegment.
 * Kontext-Felder sind Live-Mirror bereits vorhandener Runtime-States zum Laufzeitpunkt
 * (kein Recompute, keine rückwirkende Rekonstruktion) — null wenn zu diesem Zeitpunkt
 * nicht verfügbar.
 */
export type ImmersionRunSegment = {
	startTs: number;
	endTs: number;
	energyKwh: number;
	runtimeSec: number;
	valid: boolean;
	rejectReason: string | null;
	/** Live-Mirror `IMMERSION_RUNTIME_STATES.decisionSource` bei Laufbeginn (z. B. "daily_plan", "thermal_fallback"). */
	decisionSource: string | null;
	/** Live-Mirror `resolved_mode === "force"` bei Laufbeginn. */
	forcedMode: boolean | null;
	/** Live-Mirror `hygiene_status_de` bei Laufbeginn (Rohtext, kein Recompute). */
	hygieneStatusDe: string | null;
	/** Live-Mirror `ownership_owner` bei Laufbeginn. */
	ownershipOwner: string | null;
};

export type DayTelemetryStatusEvent = {
	tsIso: string;
	kind: string;
	detail: string;
};

/**
 * Struct-of-Arrays Slot-Buckets.
 * Länge = slotCount (92/96/100). Null = missing, nie erfundene 0.
 * qualityMask: null = Slot nie beobachtet (≠ ok=0).
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
	plannedConsumersRef: Array<number | null>;
	snapshotIdRef: Array<string | null>;
	/** null = unobserved; Zahl = Bitmaske (0 = alle bewerteten Domänen ok). */
	qualityMask: Array<number | null>;
};

export type DayTelemetryDayRecord = {
	dateKey: string;
	timezone: string;
	slotWidthMs: typeof DAY_TELEMETRY_SLOT_MS;
	slotCount: number;
	startMs: number;
	endMs: number;
	/** Kalendertag abgeschlossen (Mitternacht), unabhängig von Daten-Coverage. */
	complete: boolean;
	/** Erste echte Messprobe (ms / ISO) — null wenn noch keine. */
	firstSampleMs: number | null;
	firstSampleIso: string | null;
	lastSampleMs: number | null;
	lastSampleIso: string | null;
	/** Anzahl Slots mit qualityMask !== null. */
	observedSlotCount: number;
	/** observedSlotCount / slotCount × 100. */
	coveragePct: number;
	/**
	 * Phase-2-Bewertbarkeit: Coverage ≥ Schwellwert.
	 * Unabhängig von complete (Kalender).
	 */
	evaluable: boolean;
	buckets: DayTelemetryBuckets;
	plannedConsumers: FrozenPlannedConsumer[][];
	forecastSnapshots: PlannerKnowledgeSnapshot[];
	replanEvents: DayTelemetryReplanEvent[];
	climateRunSegments: ClimateRunSegment[];
	/** Additiv (Block A) — siehe ImmersionRunSegment. */
	immersionRunSegments: ImmersionRunSegment[];
	statusEvents: DayTelemetryStatusEvent[];
};

/** In-Memory-Cache mehrerer Tage (Tick/Note); Persistenz = Tagesdateien. */
export type DayTelemetryStore = {
	module: typeof DAY_TELEMETRY_MODULE;
	schemaVersion: typeof DAY_TELEMETRY_SCHEMA;
	updatedAtIso: string;
	days: Record<string, DayTelemetryDayRecord>;
};

export function emptyBuckets(slotCount: number): DayTelemetryBuckets {
	const n = (): Array<number | null> => Array.from({ length: slotCount }, () => null);
	const nMask = (): Array<number | null> => Array.from({ length: slotCount }, () => null);
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
		qualityMask: nMask(),
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
		replanEvents: [],
		climateRunSegments: [],
		immersionRunSegments: [],
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

/** Coverage-Metadaten aus qualityMask neu berechnen (keine erfundenen Messwerte). */
export function refreshDayCoverage(day: DayTelemetryDayRecord): void {
	let observed = 0;
	for (const m of day.buckets.qualityMask) {
		if (m !== null) observed++;
	}
	day.observedSlotCount = observed;
	day.coveragePct =
		day.slotCount > 0 ? Math.round((observed / day.slotCount) * 1000) / 10 : 0;
	day.evaluable = day.coveragePct >= DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT;
}

export function noteSampleTimestamps(day: DayTelemetryDayRecord, nowMs: number): void {
	const iso = new Date(nowMs).toISOString();
	if (day.firstSampleMs == null) {
		day.firstSampleMs = nowMs;
		day.firstSampleIso = iso;
	}
	day.lastSampleMs = nowMs;
	day.lastSampleIso = iso;
}

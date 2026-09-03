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
		demandModel?: string | null;
		fallbackReasonDe?: string | null;
		predictiveConfidence?: number | null;
		predictedCrossingAtIso?: string | null;
		predictedPeakRoomTempC?: number | null;
		predictedLowRoomTempC?: number | null;
		predictedPeakHumidityPct?: number | null;
		expectedRuntimeH?: number | null;
		expectedEnergyKwh?: number | null;
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
	/**
	 * Speicher-Kompaktierung (additiv, optional, siehe `forecast_horizon.ts`): NUR auf der
	 * Festplatten-Repräsentation gesetzt — sobald ein Tag über `readDayTelemetryDay`/
	 * `normalizeDayRecord` eingelesen wird, sind `priceSlots`/`pvSlotKwh` bereits wieder
	 * vollständig rekonstruiert und dieses Feld ist rein informativ (welche Basisrevision
	 * referenziert wurde). In frisch im Prozess erzeugten Snapshots (vor dem ersten Schreiben)
	 * ist es `undefined`.
	 */
	forecastRevisionId?: string;
	/**
	 * Eigene Preis-Timeline dieses Snapshots bei Delta-Kompaktierung (Start-Slot-ms + Anzahl,
	 * 15-Min-Takt — siehe `DAY_TELEMETRY_SLOT_MS`). Nötig, weil der rollierende Forecast-
	 * Horizont ständig weiterrückt: Basisrevision und Snapshot können unterschiedliche
	 * Zeitfenster abdecken, der Abgleich erfolgt daher per Timestamp, nicht per Array-Index.
	 * Nur gesetzt, wenn per Timestamp-Delta kompaktiert wurde (neues Format). Fehlt dieses Feld,
	 * aber ist `forecastPriceDelta` gesetzt, ist es Alt-Format (Index in
	 * `ForecastHorizonRevision.priceSlots`) — weiterhin unterstützt.
	 */
	forecastPriceTimelineStartMs?: number;
	forecastPriceSlotCount?: number;
	forecastPvTimelineStartMs?: number;
	forecastPvSlotCount?: number;
	/**
	 * Neues Format: [Index INNERHALB der eigenen Timeline dieses Snapshots (siehe
	 * `forecastPriceTimelineStartMs`/`forecastPriceSlotCount`), importCtPerKwh] — nur Slots ohne
	 * (oder mit abweichendem) Treffer in der Basisrevision (per Timestamp). Alt-Format (ohne
	 * `forecastPriceTimelineStartMs`): Index in `ForecastHorizonRevision.priceSlots`.
	 */
	forecastPriceDelta?: Array<[number, number]>;
	/** Analog zu `forecastPriceDelta`, für `pvSlotKwh`/`forecastPvTimelineStartMs`. */
	forecastPvDelta?: Array<[number, number]>;
};

/**
 * Speicher-Kompaktierung (siehe `forecast_horizon.ts`): EIN vollständiger Preis-/PV-Horizont,
 * den mehrere `forecastSnapshots`-Einträge per `forecastRevisionId` referenzieren, statt ihn
 * jeweils vollständig zu duplizieren. Nur bei materiell abweichendem Horizont entsteht eine
 * neue Revision — kleine Abweichungen (typ. der laufend live-aktualisierte aktuelle Slot)
 * werden stattdessen als Delta auf dem jeweiligen Snapshot gespeichert.
 */
export type ForecastHorizonRevision = {
	id: string;
	tsIso: string;
	priceSlots: Array<[number, number]>;
	pvSlotKwh: Array<[number, number]>;
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

/** Climate-Zweck in Telemetrie/Learning — nie erfunden, unknown wenn unklar. */
export type ClimateModePurpose = "cooling" | "heating" | "dehumidify" | "off" | "unknown";

/**
 * Pro-Raum-Snapshot eines 15-Min-Slots (additiv).
 * Fehlende Sensor-/Kontextwerte bleiben null — niemals erfundene 0.
 * Alte Tagesdateien ohne dieses Feld bleiben lesbar.
 */
export type ClimateUnitSlotSample = {
	unitIndex: number;
	roomTempC: number | null;
	roomHumidityPct: number | null;
	targetTempC: number | null;
	coolingOnTempC: number | null;
	coolingOffTempC: number | null;
	/** Vorhandene Heating-Schwelle (Config); kein separates On/Off in Admin. */
	heatingSetpointC: number | null;
	maxHumidityPct: number | null;
	/** cooling / heating / dehumidify — nur wirklich verfügbare Modi. */
	modesAvailable: string[];
	running: boolean | null;
	modePurpose: ClimateModePurpose;
	hardOffAt: string | null;
	demandUrgency01: number | null;
	ownershipOwner: string | null;
	overrideActive: boolean | null;
	plannedEnergyKwh: number | null;
	sharedPowerGroupId: string | null;
	activeUnitCombination: string | null;
};

/** Thermische Start-/Endbeobachtung einer Unit in einem Climate-Segment. */
export type ClimateUnitThermalObservation = {
	unitIndex: number;
	roomTempStartC: number | null;
	roomTempEndC: number | null;
	roomHumidityStartPct: number | null;
	roomHumidityEndPct: number | null;
	ownershipOwner?: string | null;
	overrideActive?: boolean | null;
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
	/** Additiv — alte Segmente ohne diese Felder bleiben gültig. */
	outdoorTempStartC?: number | null;
	outdoorTempEndC?: number | null;
	unitObservations?: ClimateUnitThermalObservation[];
	ownershipOwner?: string | null;
	overrideActive?: boolean | null;
	thermalUsable?: boolean;
	thermalRejectReason?: string | null;
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

/** Ladeherkunft je Slot — unknown/mixed statt erfundener Zuordnung. */
export type BatteryChargeSource = "pv" | "grid" | "mixed" | "unknown";

/**
 * Zusammenhängende Grid-Balance-Episode (analog ImmersionRunSegment).
 * Learning nutzt nur stabile Abschnitte; die Regelung selbst bleibt unverändert.
 */
export type GridBalanceRunSegment = {
	startTs: number;
	endTs: number;
	durationSec: number;
	requestedEnergyKwh: number;
	effectiveEnergyKwh: number;
	stableImportKwh: number | null;
	stableBatteryDischargeKwh: number | null;
	socStartPct: number | null;
	socEndPct: number | null;
	priceMinCt: number | null;
	priceMaxCt: number | null;
	stableDurationSec: number;
	unstableDurationSec: number;
	stableHouseMeanW: number | null;
	stablePvMeanW: number | null;
	stableGbMeanW: number | null;
	stableDeficitMeanW: number | null;
	abortReason: string | null;
	usable: boolean;
	qualityReason: string | null;
};

/** Stabile GB-aus-Phase zum Vergleich (keine Episode). */
export type GridBalanceMatchWindow = {
	startTs: number;
	endTs: number;
	durationSec: number;
	importKwh: number | null;
	batteryDischargeKwh: number | null;
	houseMeanW: number | null;
	pvMeanW: number | null;
	deficitMeanW: number | null;
	socMeanPct: number | null;
	priceMeanCt: number | null;
	usable: boolean;
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
	/**
	 * EMS-eigene Netzausgleichs-Entladung (kWh/Slot) aus `addons.battery.grid_balance.effective_power_w`.
	 * null = missing (alte Dateien ohne Feld, oder Slot unbeobachtet) — nie erfundene 0.
	 * 0 = gemessen aus, belastbar.
	 */
	gridBalanceDischargeKwh: Array<number | null>;
	/**
	 * Ladeherkunft je Slot: pv | grid | mixed | unknown.
	 * null = Slot unbeobachtet / keine Ladung — nie erfundene Herkunft.
	 */
	batteryChargeSource: Array<string | null>;
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
	/**
	 * Außen-Ist °C je Slot (gemapptes Weather-Actual). null = missing.
	 * Additiv — alte Dateien ohne Feld bleiben lesbar.
	 */
	outdoorTempC: Array<number | null>;
	/** Bewölkung-Ist % je Slot, sofern ohne neue Wetterarchitektur vorhanden. */
	cloudPct: Array<number | null>;
	/**
	 * Pro-Slot Climate-Unit-Snapshots (ein Array pro Slot, oder null = unbeobachtet).
	 * Additiv — alte Dateien ohne Feld bleiben lesbar.
	 */
	climateUnitSlots: Array<ClimateUnitSlotSample[] | null>;
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
	/**
	 * Speicher-Kompaktierung (additiv, optional — siehe `forecast_horizon.ts`): deduplizierte
	 * Preis-/PV-Basisrevisionen, die `forecastSnapshots[].forecastRevisionId` referenzieren.
	 * Fehlt bei älteren Tagesdateien (vor dieser Erweiterung) — dort tragen die Snapshots ihre
	 * Preis-/PV-Arrays noch vollständig inline, was weiterhin unterstützt wird.
	 */
	forecastRevisions?: ForecastHorizonRevision[];
	replanEvents: DayTelemetryReplanEvent[];
	climateRunSegments: ClimateRunSegment[];
	/** Additiv (Block A) — siehe ImmersionRunSegment. */
	immersionRunSegments: ImmersionRunSegment[];
	/** Additiv — Grid-Balance-Episoden (stabilitätsbasiert). */
	gridBalanceRunSegments: GridBalanceRunSegment[];
	/** Stabile GB-aus-Fenster für α/β-Matching. */
	gridBalanceOffWindows: GridBalanceMatchWindow[];
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
		gridBalanceDischargeKwh: n(),
		batteryChargeSource: nStr(),
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
		outdoorTempC: n(),
		cloudPct: n(),
		climateUnitSlots: Array.from({ length: slotCount }, () => null),
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
		forecastRevisions: [],
		replanEvents: [],
		climateRunSegments: [],
		immersionRunSegments: [],
		gridBalanceRunSegments: [],
		gridBalanceOffWindows: [],
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

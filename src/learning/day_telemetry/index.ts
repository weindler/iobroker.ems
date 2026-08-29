export {
	DAY_TELEMETRY_MODULE,
	DAY_TELEMETRY_SCHEMA,
	DAY_TELEMETRY_PERSIST_FILE,
	DAY_TELEMETRY_CATEGORY,
	DAY_TELEMETRY_RETENTION_DAYS,
	DAY_TELEMETRY_SLOT_MS,
	DAY_TELEMETRY_MAX_GAP_MS,
	DAY_TELEMETRY_STATES,
} from "./constants";

export { ensureDayTelemetryStates, DAY_TELEMETRY_STATE_IDS } from "./ensure_states";

export {
	tickDayTelemetry,
	noteDayTelemetryPlanPublished,
	__resetDayTelemetryRuntimeForTest,
	DAY_TELEMETRY_PERSIST_CATEGORY,
	type DayTelemetryHost,
} from "./record";

export {
	buildDaySlotLayout,
	slotIndexForMs,
	overlappingSlotIndices,
} from "./slots";

export {
	energyCounterDeltaPreciseKwh,
	splitAmountAcrossSlots,
	integratePowerAcrossSlots,
	decideIntegrationGap,
	roundTelemetryKwh,
	applySharesToBucket,
	addToBucket,
} from "./energy_integrate";

export {
	TELEMETRY_DOMAIN,
	DOMAIN_QUALITY,
	encodeDomainQuality,
	decodeDomainQuality,
	encodeQualityMask,
	worstDomainQuality,
} from "./quality_mask";

export {
	freezePlannedConsumersForSlot,
	dedupePlannedConsumers,
	sharedGroupMapFromClimateUnits,
} from "./planned_freeze";

export {
	buildPlannerKnowledgeSnapshot,
	hashPlannerKnowledgeContent,
	withSnapshotId,
	upsertForecastSnapshot,
} from "./knowledge_snapshot";

export {
	pruneDayTelemetryStore,
	writeDayTelemetryPersist,
	readDayTelemetryPersist,
	loadOrEmptyDayTelemetryStore,
	dayTelemetryPersistPath,
} from "./persist";

export {
	resolveTelemetryPriceCtPerKwh,
	resolveActiveSharedPowerGroupId,
	activeUnitCombinationKey,
} from "./sources";

export {
	advanceClimateSegment,
	closeClimateSegment,
} from "./climate_segments";
export type {
	DayTelemetryStore,
	DayTelemetryDayRecord,
	DayTelemetryBuckets,
	FrozenPlannedConsumer,
	PlannerKnowledgeSnapshot,
	ClimateRunSegment,
	DayTelemetryReplanEvent,
} from "./types";

export { emptyDayRecord, emptyBuckets, emptyDayTelemetryStore } from "./types";

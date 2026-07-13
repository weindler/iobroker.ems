import type { PLANNER_INPUT_SCHEMA_VERSION } from "./constants";

export type SnapshotScalar = string | number | boolean | null;
export type SnapshotUnknown = "unknown";

export interface SnapshotStateValue {
	value: SnapshotScalar;
	/** ISO timestamp of observation when known; omitted when unavailable. */
	observedAt?: string | null;
}

export interface SnapshotHouseLoadSegment {
	segmentId: string;
	hour: number;
	avgW: number | null;
}

export interface SnapshotHouseLoadDayForecast {
	dateKey: string;
	segments: SnapshotHouseLoadSegment[];
	dailyKwh: number | null;
}

export interface SnapshotPriceSlot15Min {
	slotStartIso: string;
	priceCtPerKwh: number | null;
}

export interface SnapshotPvHorizonDay {
	dayIndex: number;
	dateKey: string;
	correctedKwh: number | null;
	confidencePct: number | null;
}

export interface SnapshotPolicyFields {
	revision: string | null;
	status: string | null;
	gridImportAllowed: boolean | null;
	maxGridImportW: number | null;
	houseFuseLimitW: number | null;
	energyPriority: string[] | null;
	mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }> | null;
}

export interface SnapshotThermalIntent {
	mode: "off" | "auto" | "force" | SnapshotUnknown;
	operatingRequestStatus: string | null;
}

export interface SnapshotBatteryIntent {
	operatingRequest: string | null;
	operatingRequestStatus: string | null;
	topOffRequested: boolean | null;
	hold: boolean;
	charge: boolean;
}

export interface SnapshotImmersionStage {
	index: number;
	enabled: boolean;
	nominalPowerW: number;
	/** Stage label only — no device write state id. */
	label: string | null;
}

export interface SnapshotImmersionConfig {
	forecastModeEnabled: boolean;
	planningMaxTempC: number | null;
	stages: SnapshotImmersionStage[];
	minRuntimeMin: number | null;
	minPauseMin: number | null;
}

export interface SnapshotThermalRuntimeCycle {
	startTs: number;
	endTs: number;
	startTempC: number;
	endTempC: number;
	runtimeHours: number;
	coolingRateCPerH: number;
	season: string;
	dayType: string;
}

export interface SnapshotThermalRuntimeGroupSummary {
	samples: number;
	runtime_hours_avg: number | null;
	runtime_hours_median: number | null;
	cooling_rate_c_per_h_avg: number | null;
}

export interface SnapshotThermalRuntimeLearning {
	status: string | null;
	health: string | null;
	samples: number | null;
	runtimeHoursAvg: number | null;
	runtimeHoursMedian: number | null;
	coolingRateCPerHAvg: number | null;
	coolingKPerH: number | null;
	coolingAsymptoteC: number | null;
	coolingAsymptoteSource: string | null;
	currentTemperatureC: number | null;
	estimatedRemainingHours: number | null;
	estimatedEmptyAt: string | null;
	generatedAt: string | null;
	bySeason: Record<string, SnapshotThermalRuntimeGroupSummary> | null;
	byDayType: Record<string, SnapshotThermalRuntimeGroupSummary> | null;
	history: SnapshotThermalRuntimeCycle[];
}

export interface SnapshotConsumerStatEntry {
	consumerKey: string;
	totalRuntimeSec: number | null;
	totalEnergyKwh: number | null;
	todayRuntimeSec: number | null;
	todayEnergyKwh: number | null;
	sessionRuntimeSec: number | null;
	sessionEnergyKwh: number | null;
}

export interface SnapshotAcUnit {
	index: number;
	enabled: boolean;
	roomTempC: number | null;
	targetTempC: number | null;
	state: string | null;
	cleaningActive: boolean | null;
	consumerKey: string | null;
	learnedPowerW: number | null;
}

export interface SnapshotBatteryWinterDay {
	dayIndex: number;
	dateKey: string;
	pvKwh: number | null;
	loadKwh: number | null;
	pvConfidencePct: number | null;
}

export interface SnapshotBatteryWinterConfig {
	enabled: boolean;
	horizonDays: number;
	socTargetMinPct: number | null;
	socTargetMaxPct: number | null;
}

export interface SnapshotGovernanceAddon {
	addonId: string;
	enabled: boolean | null;
	governanceEnabled: boolean | null;
	aiAllowed: boolean | null;
}

export interface SnapshotWallboxEvcc {
	connected: boolean | null;
	charging: boolean | null;
	vehicleSocPct: number | null;
	planSocPct: number | null;
	planActive: boolean | null;
	sessionEnergyKwh: number | null;
	deadlineIso: string | null;
	activePhases: number | null;
	maxCurrentA: number | null;
	evccConfigured: boolean;
	batteryMode: string | null;
	batteryDischargeControl: boolean | null;
}

export interface SnapshotBatteryTelemetry {
	socPct: number | null;
	capacityEffectiveKwh: number | null;
	capacityNetKwh: number | null;
	capacitySource: string | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	maxChargeW: number | null;
	chargeCapable: boolean | null;
	dischargeCapable: boolean | null;
	fault: boolean | null;
	lockout: boolean | null;
	telemetryValid: boolean | null;
	telemetryStale: boolean | null;
	telemetryReady: boolean | null;
	ownershipActive: boolean | null;
	winterGridActive: boolean | null;
}

export interface SnapshotLiveMeasurements {
	pvPowerW: number | null;
	houseLoadW: number | null;
	socPct: number | null;
	bufferTempC: number | null;
	outdoorTempC: number | null;
	cloudPct: number | null;
	currentPriceCtPerKwh: number | null;
	fixedPriceCtPerKwh: number | null;
}

export interface SnapshotLearningPvBias {
	correctedTodayKwh: number | null;
	correctedTomorrowKwh: number | null;
	rawTodayKwh: number | null;
	rawTomorrowKwh: number | null;
	confidencePct: number | null;
	status: string | null;
	lastUpdateTs: string | null;
}

export interface SnapshotLearningHouseLoad {
	status: string | null;
	confidence: number | null;
	lastUpdate: string | null;
	forecastToday: SnapshotHouseLoadDayForecast | null;
	forecastTomorrow: SnapshotHouseLoadDayForecast | null;
}

export interface SnapshotLearningWeather {
	status: string | null;
	health: string | null;
	confidencePct: number | null;
	lastUpdate: string | null;
	forecastSource: string | null;
	actualSource: string | null;
}

/**
 * Full planner input snapshot — schema v2.
 * Fully JSON-serializable; no adapter, functions, credentials, or legacy full plans.
 */
export interface PlannerInputSnapshot {
	schemaVersion: typeof PLANNER_INPUT_SCHEMA_VERSION;
	capturedAt: string;
	timezone: string;
	inputRevision: string;
	sourceRevision: string | null;
	general: {
		globalMode: string | null;
		executionMode: string | null;
		globalModePolicyLabel: string | null;
		snowCoverSuspected: boolean | null;
	};
	policy: SnapshotPolicyFields;
	live: SnapshotLiveMeasurements;
	learning: {
		pvBias: SnapshotLearningPvBias;
		pvHorizon: SnapshotPvHorizonDay[];
		houseLoad: SnapshotLearningHouseLoad;
		weather: SnapshotLearningWeather;
		thermalRuntime: SnapshotThermalRuntimeLearning;
	};
	prices: {
		slots15Min: SnapshotPriceSlot15Min[];
	};
	intents: {
		thermal: SnapshotThermalIntent;
		battery: SnapshotBatteryIntent;
	};
	battery: SnapshotBatteryTelemetry;
	wallbox: SnapshotWallboxEvcc;
	thermal: {
		bufferTempC: number | null;
		runtimeState: string | null;
		faultActive: boolean | null;
		config: SnapshotImmersionConfig;
	};
	airConditioning: {
		units: SnapshotAcUnit[];
	};
	governance: {
		addons: SnapshotGovernanceAddon[];
	};
	consumerStats: SnapshotConsumerStatEntry[];
	batteryWinter: {
		config: SnapshotBatteryWinterConfig;
		days: SnapshotBatteryWinterDay[];
	};
}

export interface PlannerInputWriteResult {
	path: string;
	byteSize: number;
	sha256: string;
	inputRevision: string;
}

export class PlannerInputSnapshotBudgetError extends Error {
	constructor(
		public readonly byteSize: number,
		public readonly budgetBytes: number,
	) {
		super(`input snapshot exceeds budget: ${byteSize} > ${budgetBytes} bytes`);
		this.name = "PlannerInputSnapshotBudgetError";
	}
}

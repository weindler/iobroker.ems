export const CONSUMER_STATS_FILENAME = "consumer_stats_v1.json";
export const CONSUMER_STATS_MODULE = "consumer_stats_v1";
export const DEFAULT_RETENTION_DAYS = 120;
export const MAX_TICK_DELTA_SEC = 30;

export type ConsumerDayRecord = {
	dateKey: string;
	runtimeSec: number;
	energyKwh: number;
	lastTickMs: number;
};

export type ConsumerPersistEntry = {
	consumerKey: string;
	totalRuntimeSec: number;
	totalEnergyKwh: number;
	todayDateKey: string;
	todayRuntimeSec: number;
	todayEnergyKwh: number;
	sessionRuntimeSec: number;
	sessionEnergyKwh: number;
	lastSessionRuntimeSec: number;
	lastSessionEnergyKwh: number;
	lastTickMs: number;
	wasActive: boolean;
	days: Record<string, ConsumerDayRecord>;
};

export type ConsumerStatsPersist = {
	version: 1;
	generated_at: string;
	consumers: Record<string, ConsumerPersistEntry>;
};

export type ConsumerStatsConfig = {
	enabled: boolean;
	trackRuntime: boolean;
	trackEnergy: boolean;
	runtimeOffsetSec: number;
	energyOffsetKwh: number;
};

export type ConsumerStatsTickInput = {
	consumerKey: string;
	nowMs: number;
	/** EMS führt das Gerät (Anzeige device_active). */
	deviceActive: boolean;
	/** Nur Live: Laufzeit/Verbrauch mitzählen. */
	countable: boolean;
	measuredPowerW: number | null;
	commandedPowerW: number;
	powerOnThresholdW?: number;
};

export type ConsumerStatsSnapshot = {
	consumerKey: string;
	tracking: boolean;
	deviceActive: boolean;
	todayRuntimeSec: number;
	todayEnergyKwh: number;
	totalRuntimeSec: number;
	totalEnergyKwh: number;
	sessionRuntimeSec: number;
	sessionEnergyKwh: number;
	lastSessionRuntimeSec: number;
	lastSessionEnergyKwh: number;
	lastUpdated: string;
};

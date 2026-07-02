export const ENERGY_DAILY_FILENAME = "energy_daily_v1.json";
export const ENERGY_DAILY_MODULE = "energy_daily_rollup_v1";
export const DEFAULT_RETENTION_DAYS = 120;

export type DailyEnergyRecord = {
	dateKey: string;
	kwh: number;
	lastSampleTs: number;
	sampleCount: number;
};

export type DailyEnergySourcePersist = {
	sourceKey: string;
	stateId: string;
	backfillDone: boolean;
	days: Record<string, DailyEnergyRecord>;
};

export type EnergyDailyPersist = {
	version: 1;
	generated_at: string;
	sources: Record<string, DailyEnergySourcePersist>;
};

export type DailyEnergySourceDef = {
	sourceKey: string;
};

export type ResolvedDailyEnergySource = DailyEnergySourceDef & {
	stateId: string;
	lookbackDays: number;
};

export type DayBuffer = {
	dateKey: string;
	kwh: number;
	lastSampleTs: number;
	sampleCount: number;
};

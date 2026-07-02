export const POWER_HOURLY_FILENAME = "power_hourly_v1.json";
export const POWER_ROLLUP_MODULE = "power_hourly_rollup_v1";
export const DEFAULT_RETENTION_DAYS = 120;

export type PowerHourlyRecord = {
	hourKey: string;
	sampleCount: number;
	chargeSamples: number;
	dischargeSamples: number;
	maxChargeW: number | null;
	/** Entladeleistung als positiver Betrag (EMS-intern: −W beim Export). */
	maxDischargeW: number | null;
	lastSampleTs: number;
};

export type PowerSourcePersist = {
	sourceKey: string;
	stateId: string;
	powerInvert: boolean;
	backfillDone: boolean;
	hours: Record<string, PowerHourlyRecord>;
};

export type PowerHourlyPersist = {
	version: 1;
	generated_at: string;
	sources: Record<string, PowerSourcePersist>;
};

export type DensePowerSourceDef = {
	sourceKey: string;
	addonId: string;
	role: string;
};

export type ResolvedDensePowerSource = DensePowerSourceDef & {
	stateId: string;
	powerInvert: boolean;
};

export type HourBuffer = {
	hourKey: string;
	sampleCount: number;
	chargeSamples: number;
	dischargeSamples: number;
	maxChargeW: number | null;
	maxDischargeW: number | null;
	lastSampleTs: number;
};

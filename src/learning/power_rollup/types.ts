export const POWER_HOURLY_FILENAME = "power_hourly_v1.json";
export const POWER_ROLLUP_MODULE = "power_hourly_rollup_v1";
export const DEFAULT_RETENTION_DAYS = 120;

/** battery power_w: max Lade-/Entlade-Peak pro Stunde */
export type PowerRollupMode = "bidirectional_max" | "unidirectional_avg";

export type PowerHourlyRecord = {
	hourKey: string;
	sampleCount: number;
	lastSampleTs: number;
	/** bidirectional_max */
	chargeSamples: number;
	dischargeSamples: number;
	maxChargeW: number | null;
	/** Entladeleistung als positiver Betrag (EMS-intern: −W beim Export). */
	maxDischargeW: number | null;
	/** unidirectional_avg (Hauslast) */
	sumPowerW?: number;
	avgPowerW?: number | null;
};

export type PowerSourcePersist = {
	sourceKey: string;
	stateId: string;
	rollupMode: PowerRollupMode;
	powerInvert: boolean;
	powerUnit: "W" | "kW";
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
	rollupMode: PowerRollupMode;
};

export type ResolvedDensePowerSource = DensePowerSourceDef & {
	stateId: string;
	lookbackDays: number;
	powerInvert: boolean;
	powerUnit: "W" | "kW";
};

export type HourBuffer = {
	hourKey: string;
	rollupMode: PowerRollupMode;
	sampleCount: number;
	chargeSamples: number;
	dischargeSamples: number;
	maxChargeW: number | null;
	maxDischargeW: number | null;
	sumPowerW: number;
	lastSampleTs: number;
};

export function effectiveRollupMode(source: Pick<PowerSourcePersist, "rollupMode">): PowerRollupMode {
	return source.rollupMode ?? "bidirectional_max";
}

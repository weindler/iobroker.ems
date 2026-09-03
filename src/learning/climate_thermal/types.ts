/**
 * Persistentes Climate-Thermal-Learning.
 * Operativ nur wenn usable=true (Predictive). Unusable bleibt Diagnose/Bootstrap.
 */

export const CLIMATE_THERMAL_FILENAME = "climate_thermal_v1.json";
export const CLIMATE_THERMAL_MODULE = "climate_thermal_v1";

export type ClimateThermalStatus = "ok" | "not_evaluable" | "unavailable";
export type ClimateThermalModeKey = "passive" | "cooling" | "heating" | "dehumidify";

export type ClimateThermalEffectStat = {
	sampleCount: number;
	usableDurationSec: number;
	/** Median der Rate (K/h bzw. %RH/h). null wenn nicht auswertbar — nie erfundene 0. */
	rate: number | null;
	/** IQR der Rate. */
	spread: number | null;
	confidence: number;
	usable: boolean;
	status: ClimateThermalStatus;
	reasonDe: string;
	lastRunIso: string | null;
	soloSampleCount: number;
	sharedSampleCount: number;
};

export type ClimateThermalPassiveStat = ClimateThermalEffectStat & {
	/** Median nur der positiven ΔT/h (Erwärmung). */
	warmingRateKPerH: number | null;
	/** Median nur der negativen ΔT/h (Abkühlung). */
	coolingRateKPerH: number | null;
};

export type ClimateThermalDehumidifyStat = {
	temp: ClimateThermalEffectStat;
	humidity: ClimateThermalEffectStat;
};

export type ClimateThermalUnitModel = {
	unitIndex: number;
	passive: ClimateThermalPassiveStat;
	cooling: ClimateThermalEffectStat;
	heating: ClimateThermalEffectStat;
	dehumidify: ClimateThermalDehumidifyStat;
	inertia: ClimateThermalEffectStat;
	reasonDe: string;
	lastRunIso: string | null;
};

export type ClimateThermalPersist = {
	version: 1;
	generatedAtIso: string;
	units: Record<string, ClimateThermalUnitModel>;
};

export function emptyEffectStat(
	status: ClimateThermalStatus,
	reasonDe: string,
	lastRunIso: string | null = null,
): ClimateThermalEffectStat {
	return {
		sampleCount: 0,
		usableDurationSec: 0,
		rate: null,
		spread: null,
		confidence: 0,
		usable: false,
		status,
		reasonDe,
		lastRunIso,
		soloSampleCount: 0,
		sharedSampleCount: 0,
	};
}

export function emptyPassiveStat(
	status: ClimateThermalStatus,
	reasonDe: string,
	lastRunIso: string | null = null,
): ClimateThermalPassiveStat {
	return {
		...emptyEffectStat(status, reasonDe, lastRunIso),
		warmingRateKPerH: null,
		coolingRateKPerH: null,
	};
}

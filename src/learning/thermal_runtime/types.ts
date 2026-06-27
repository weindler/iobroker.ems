import type { ThermalDayType, ThermalSeason } from "./constants";

export type ThermalRuntimeConfig = {
	enabled: boolean;
	lookbackDays: number;
	temperatureStateId: string;
	fullThresholdC: number;
	emptyThresholdC: number;
	minRuntimeHours: number;
	maxRuntimeHours: number;
};

export type TempPoint = {
	ts: number;
	tempC: number;
};

export type RuntimeCycle = {
	startTs: number;
	endTs: number;
	startTempC: number;
	endTempC: number;
	runtimeHours: number;
	coolingRateCPerH: number;
	season: ThermalSeason;
	dayType: ThermalDayType;
};

export type GroupSummary = {
	samples: number;
	runtime_hours_avg: number | null;
	runtime_hours_median: number | null;
	cooling_rate_c_per_h_avg: number | null;
};

export type ThermalRuntimeHealth =
	| "ok"
	| "degraded"
	| "no_samples"
	| "no_data"
	| "invalid_config"
	| "no_source"
	| "error";

export type ThermalRuntimeComputeResult = {
	status:
		| "ready"
		| "insufficient_data"
		| "no_source"
		| "disabled"
		| "invalid_config"
		| "error";
	health: ThermalRuntimeHealth;
	samples: number;
	runtimeHoursAvg: number | null;
	runtimeHoursMedian: number | null;
	coolingRateCPerHAvg: number | null;
	coolingConstantPerH: number | null;
	coolingAsymptoteC: number | null;
	coolingAsymptoteSource: "fitted" | "default" | null;
	currentTemperatureC: number | null;
	estimatedRemainingHours: number | null;
	estimatedEmptyAt: string | null;
	bySeasonJson: Partial<Record<ThermalSeason, GroupSummary>>;
	byDayTypeJson: Partial<Record<ThermalDayType, GroupSummary>>;
	historyJson: RuntimeCycle[];
	sourceStateId: string;
	lastError: string;
};

export type ThermalRuntimePersist = {
	generated_at: string;
	module: string;
	samples: number;
	runtime_hours_avg: number | null;
	runtime_hours_median: number | null;
	cooling_rate_c_per_h_avg: number | null;
	by_season: Partial<Record<ThermalSeason, GroupSummary>>;
	by_day_type: Partial<Record<ThermalDayType, GroupSummary>>;
	history: RuntimeCycle[];
	health: ThermalRuntimeHealth;
};

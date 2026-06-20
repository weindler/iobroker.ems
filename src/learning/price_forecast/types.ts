export type PriceForecastStatus =
	| "ready"
	| "insufficient_data"
	| "missing_forecast"
	| "error"
	| "disabled";

export type PriceForecastHealth = "ok" | "warning" | "error";
export type ForecastStability = "stable" | "normal" | "volatile" | "unknown";

export type PriceForecastConfig = {
	enabled: boolean;
	freezeEnabled: boolean;
	/** Morgen-Freeze (PricesTomorrow.json), Standard 14:00 */
	tomorrowFreezeTime: string;
	/** Heute-Freeze (PricesToday.json), Standard 06:00 */
	todayFreezeEnabled: boolean;
	todayFreezeTime: string;
	todayJsonStateId: string;
	tomorrowJsonStateId: string;
	actualStateId: string;
	lookbackDays: number;
};

export type FrozenHourSlot = {
	hourStartMs: number;
	forecastCtPerKwh: number;
};

export type PriceForecastFreezeFile = {
	module: string;
	frozen_at: string;
	freeze_date: string;
	target_date: string;
	forecast_source: string;
	slots: FrozenHourSlot[];
};

export type MatchedHourPair = {
	targetDate: string;
	hourStartMs: number;
	forecastCt: number;
	actualCt: number;
	absErrorCt: number;
};

export type PriceForecastResult = {
	status: PriceForecastStatus;
	health: PriceForecastHealth;
	forecastConfidence: number;
	sampleDays: number;
	coveragePct: number;
	missingDays: number;
	forecastAccuracy7d: number | null;
	forecastAccuracy30d: number | null;
	forecastAccuracy90d: number | null;
	avgErrorCt7d: number | null;
	avgErrorCt30d: number | null;
	avgErrorCt90d: number | null;
	stability: ForecastStability;
	forecastSource: string;
	actualSource: string;
	error: string;
};

export type PriceForecastPersist = {
	generated_at: string;
	module: string;
	sample_days: number;
	coverage_pct: number;
	missing_days: number;
	forecast_accuracy_7d: number | null;
	forecast_accuracy_30d: number | null;
	forecast_accuracy_90d: number | null;
	avg_error_ct_7d: number | null;
	avg_error_ct_30d: number | null;
	avg_error_ct_90d: number | null;
	forecast_confidence: number;
	stability: ForecastStability;
	health: {
		status: PriceForecastHealth;
		sample_days: number;
		coverage_pct: number;
		missing_days: number;
		last_run: string;
		forecast_confidence: number;
	};
};

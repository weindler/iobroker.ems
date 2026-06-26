export type PriceUnit = "ct_per_kwh" | "eur_per_kwh";

export type PriceLearningStatus =
	| "ready"
	| "insufficient_data"
	| "missing_mapping"
	| "error"
	| "disabled";

export type PriceHealthLevel = "ok" | "warning" | "degraded" | "error";

export type PriceDaySummary = {
	dateKey: string;
	dayOffset: number;
	validHours: number;
	avgPriceEur: number | null;
};

export type PriceLearningConfig = {
	enabled: boolean;
	priceStateId: string;
	lookbackDays: number;
};

export type PriceLearningResult = {
	status: PriceLearningStatus;
	health: PriceHealthLevel;
	confidence: number;
	sampleDays: number;
	coveragePct: number;
	missingDays: number;
	avgPrice7d: number | null;
	avgPrice30d: number | null;
	avgPrice90d: number | null;
	volatility30d: number | null;
	cheapHours: Record<string, number>;
	expensiveHours: Record<string, number>;
	priceSource: string;
	error: string;
};

export type PriceLearningPersist = {
	generated_at: string;
	module: string;
	price_source: string;
	sample_days: number;
	coverage_pct: number;
	missing_days: number;
	avg_price_7d: number | null;
	avg_price_30d: number | null;
	avg_price_90d: number | null;
	volatility_30d: number | null;
	cheap_hours: Record<string, number>;
	expensive_hours: Record<string, number>;
	confidence: number;
	health: {
		status: PriceHealthLevel;
		sample_days: number;
		coverage_pct: number;
		missing_days: number;
		last_run: string;
		confidence: number;
	};
};

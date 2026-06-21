export type BatteryRuntimeConfig = {
	enabled: boolean;
	lookbackDays: number;
	socStateId: string;
	powerStateId: string;
	/** Quell-Vorzeichen umdrehen (+ laden / − entladen nach Normalisierung). */
	powerInvert: boolean;
	capacityStateId: string;
	fullChargeSoc: number;
	topoffIntervalDays: number;
	nightStart: string;
	nightEnd: string;
};

export type SocPoint = {
	ts: number;
	socPct: number;
};

export type PowerPoint = {
	ts: number;
	powerW: number;
};

export type BatteryRuntimeComputeResult = {
	status:
		| "ready"
		| "insufficient_data"
		| "no_source"
		| "disabled"
		| "partial"
		| "error";
	sampleDays: number;
	avgNightDischargePct: number | null;
	avgNightDischargeKwh: number | null;
	avgChargeRatePctH: number | null;
	avgDischargeRatePctH: number | null;
	avgChargePowerW: number | null;
	avgDischargePowerW: number | null;
	maxChargePowerW: number | null;
	maxDischargePowerW: number | null;
	lastFullCharge: string | null;
	daysSinceFull: number | null;
	topoffIntervalDays: number;
	topoffDaysRemaining: number | null;
	topoffDue: boolean | null;
	estimatedRuntimeDays: number | null;
	currentSocPct: number | null;
	capacityKwh: number | null;
	sourceSocStateId: string;
	sourcePowerStateId: string;
	lastError: string;
};

export type BatteryRuntimePersist = {
	generated_at: string;
	module: string;
	sample_days: number;
	avg_night_discharge_pct: number | null;
	avg_night_discharge_kwh: number | null;
	avg_charge_rate_pct_h: number | null;
	avg_discharge_rate_pct_h: number | null;
	avg_charge_power_w: number | null;
	avg_discharge_power_w: number | null;
	max_charge_power_w: number | null;
	max_discharge_power_w: number | null;
	last_full_charge: string | null;
	days_since_full: number | null;
	topoff_interval_days: number;
	topoff_days_remaining: number | null;
	topoff_due: boolean | null;
	estimated_runtime_days: number | null;
};

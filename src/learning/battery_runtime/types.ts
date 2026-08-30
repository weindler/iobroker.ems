export type BatteryRuntimeConfig = {
	enabled: boolean;
	lookbackDays: number;
	socStateId: string;
	powerStateId: string;
	/** Quell-Vorzeichen umdrehen (+ laden / − entladen nach Normalisierung). */
	powerInvert: boolean;
	capacityStateId: string;
	/** Sonnen o. ä.: Sekunden seit echter Vollladung (Zelloptimierung). */
	secondsSinceFullStateId: string;
	fullChargeSoc: number;
	topoffIntervalDays: number;
	nightStart: string;
	nightEnd: string;
	/** Nachtfenster aus Astro-History (z. B. javascript.0.variables.astro.dusk/dawn). */
	nightAstroEnabled: boolean;
	nightStartStateId: string;
	nightEndStateId: string;
};

export type AstroTimePoint = {
	ts: number;
	dateKey: string;
	hour: number;
	minute: number;
};

export type DailyAstroTimes = {
	startByDate: Map<string, { hour: number; minute: number }>;
	endByDate: Map<string, { hour: number; minute: number }>;
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
	/** Einheitlicher Ø-Nachtenergiebedarf (kWh) für Reserve: max(Haus, Batterie-Entladung, SOC-Delta). */
	predictedNightConsumptionKwh: number | null;
	/** Nächte mit belastbarem Nachtenergie-Bedarf (kann von nightBridgeValidNights abweichen). */
	nightConsumptionValidNights: number;
	/** Abgeleitet: Ø Hauslast-Nachtverbrauch minus SOC-Entladung (Diagnose). */
	predictedNightGridImportKwh: number | null;
	/** Abgeleitet: predictedNightConsumptionKwh / avgNightBridgeHours × 1000 (konsistent zur Reserve-Basis). */
	avgNightLoadW: number | null;
	/** Dynamische Reserve (Phase 1d) — ersetzt feste 50-%-Schwelle; null = noch nicht berechenbar. */
	requiredSocAtPvEndPct: number | null;
	requiredNightReserveKwh: number | null;
	nightReserveReasonDe: string;
	avgChargeRatePctH: number | null;
	avgDischargeRatePctH: number | null;
	avgChargePowerW: number | null;
	avgDischargePowerW: number | null;
	maxChargePowerW: number | null;
	maxDischargePowerW: number | null;
	lastFullCharge: string | null;
	daysSinceFull: number | null;
	/** Live-Wert vom Geräte-State (Sekunden seit Vollladung). */
	secondsSinceFullCharge: number | null;
	/** device = Geräte-State; soc_history = SOC-History-Fallback. */
	fullChargeSource: "device" | "soc_history" | null;
	topoffIntervalDays: number;
	topoffDaysRemaining: number | null;
	topoffDue: boolean | null;
	estimatedRuntimeDays: number | null;
	currentSocPct: number | null;
	capacityKwh: number | null;
	sourceSocStateId: string;
	sourcePowerStateId: string;
	lastError: string;
	/** Diagnose: History-Zeilen gesamt (pacTotal o. ä.). */
	powerHistoryRawRows: number | null;
	/** Diagnose: gültige Zeilen nach Deadband/Plausibilität. */
	powerHistoryNormalizedRows: number | null;
	/** Diagnose: Roh-Samples mit positiver Ladeleistung (nach Normalisierung). */
	powerRawChargeSamples: number | null;
	/** Diagnose: Roh-Samples mit Entladeleistung. */
	powerRawDischargeSamples: number | null;
	/** Diagnose: Stunden-Buckets mit Lade-Peak. */
	powerHourlyChargePoints: number | null;
	/** Diagnose: Stunden-Buckets mit Entlade-Peak. */
	powerHourlyDischargePoints: number | null;
	/** Diagnose: 1 = Vorzeichen invertiert (Sonnen pacTotal). */
	powerInvertApplied: boolean | null;
	/** Diagnose: 1 = Invert automatisch erkannt. */
	powerInvertAuto: boolean | null;
	/** Diagnose: ems_rollup oder history_fallback. */
	powerHistoryMode: string;
	/** pv_house | battery_discharge | astro | fixed_clock | none */
	nightBridgeMethod: string;
	/** Ø Dauer der gelernten Nachtbrücke (h). */
	avgNightBridgeHours: number | null;
	/** Nächte mit gültiger SOC-Entladung in der gewählten Methode. */
	nightBridgeValidNights: number;
};

export type BatteryRuntimePersist = {
	generated_at: string;
	module: string;
	sample_days: number;
	avg_night_discharge_pct: number | null;
	avg_night_discharge_kwh: number | null;
	predicted_night_consumption_kwh?: number | null;
	night_consumption_valid_nights?: number;
	predicted_night_grid_import_kwh?: number | null;
	avg_night_load_w?: number | null;
	required_soc_at_pv_end_pct?: number | null;
	required_night_reserve_kwh?: number | null;
	night_bridge_method?: string;
	night_bridge_valid_nights?: number;
	avg_night_bridge_hours?: number | null;
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

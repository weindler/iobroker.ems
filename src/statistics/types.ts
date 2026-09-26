/**
 * Statistik-Sidecar (Reporting only).
 * Liest EMS-/Fremd-States, schreibt nur unter statistics.* — keine Planner-/Runtime-Änderung.
 */

export const STATISTICS_PERSIST_VERSION = 1 as const;

export type IceFuelType = "e5" | "e10" | "diesel";

export type ChargeSourceKind = "home_pv" | "home_grid" | "grid_rewards" | "public_dc" | "unknown";

/** Quelle der Grid-Rewards-Gutschrift in der Statistik-Anzeige. */
export type GridRewardsSource = "off" | "estimate_day" | "estimate_month" | "billing";

export interface MonthRewardsBilling {
	creditEur: number;
	noteDe?: string;
}

export type PublicChargeSessionStatus = "pending_invoice" | "invoiced" | "discarded";

export interface PublicChargeSession {
	id: string;
	openedAtIso: string;
	closedAtIso: string | null;
	estimatedKwh: number | null;
	invoiceKwh: number | null;
	invoiceEur: number | null;
	fuelPriceEurPerLSnapshot: number | null;
	status: PublicChargeSessionStatus;
	noteDe: string;
}

export interface HomeDayTotals {
	dateKey: string;
	gridImportKwh: number | null;
	gridExportKwh: number | null;
	/** Dynamisch (Tibber-Integration / gemappte Tageskosten). */
	dynamicCostEur: number | null;
	/** Dieselbe Import-kWh × Festtarif (+ anteilige Grundgebühr). */
	fixedTariffCostEur: number | null;
	/** fixed − dynamic (positiv = Tibber/EMS günstiger als Festtarif). */
	savingsVsFixedEur: number | null;
	gridRewardsCreditEur: number | null;
	gridRewardsSource: GridRewardsSource;
	feedInCreditEur: number | null;
}

export interface MobilityDayTotals {
	dateKey: string;
	homePvKwh: number | null;
	homeGridKwh: number | null;
	homePvCostEur: number | null;
	homeGridCostEur: number | null;
	homeGridCostNetEur: number | null;
	gridRewardsCreditEur: number | null;
	gridRewardsSource: GridRewardsSource;
	publicInvoicedKwh: number | null;
	publicInvoicedEur: number | null;
	publicPendingKwh: number | null;
	evTotalCostEur: number | null;
	evKwhPer100Km: number | null;
	evKwhPer100KmSource: "ford_hass" | "admin_fallback" | "missing" | null;
	estimatedKm: number | null;
	iceLiters: number | null;
	iceFuelPriceEurPerL: number | null;
	iceCostEur: number | null;
	/** ice − ev (positiv = E-Auto günstiger). */
	savingsVsIceEur: number | null;
}

/**
 * Rein energetische Tagesbilanz aus der Day-Telemetry.
 *
 * Alle Werte beziehen sich nur auf tatsächlich beobachtete Slots. `coveragePct`, `complete`
 * und `evaluable` machen sichtbar, ob daraus bereits ein belastbarer ganzer Tag geworden ist.
 * Fehlende Messketten bleiben `null`; insbesondere werden keine Nullen ergänzt.
 */
export interface EnergeticDayTotals {
	dateKey: string;
	source: "day_telemetry";
	complete: boolean;
	evaluable: boolean;
	coveragePct: number;
	pvGenerationKwh: number | null;
	houseConsumptionKwh: number | null;
	gridImportKwh: number | null;
	gridExportKwh: number | null;
	selfConsumptionKwh: number | null;
	selfConsumptionPct: number | null;
	/** PV-Menge der gemeinsam beobachteten PV-/Export-Slots als Prozentbasis. */
	selfConsumptionPvBasisKwh: number | null;
	autonomyPct: number | null;
	/** Hausverbrauch der gemeinsam beobachteten Haus-/Import-Slots als Prozentbasis. */
	autonomyConsumptionBasisKwh: number | null;
	autonomyGridImportBasisKwh: number | null;
	batteryChargedKwh: number | null;
	batteryDischargedKwh: number | null;
	batteryPvChargedKwh: number | null;
	batteryPvSharePct: number | null;
	/** Nur bei vollständiger SOC-/Kapazitäts-/Leistungs-Messkette, sonst null. */
	batteryMeasuredLossKwh: number | null;
	/** Veränderung der gespeicherten Energie zwischen gemessenen SOC-Tagesgrenzen. */
	batteryStoredChangeKwh?: number | null;
	immersionEnergyKwh: number | null;
	immersionPvKwh: number | null;
	immersionPvSharePct: number | null;
	evChargedKwh: number | null;
	evPvKwh: number | null;
	evPvSharePct: number | null;
	/** EVCC-Schnellmodus (`now`) — tatsächliche Wallboxenergie. */
	evFastChargedKwh: number | null;
	/** Proportionaler Anteil der Hausbatterie an der Schnellmodus-Ladung. */
	evFastBatteryKwh: number | null;
	evFastBatterySharePct: number | null;
	/** Proportionaler Netzanteil an der Schnellmodus-Ladung. */
	evFastGridKwh: number | null;
	evFastGridSharePct: number | null;
	/** Verbleibende lokale Versorgung (typisch PV) nach Batterie und Netz. */
	evFastLocalKwh: number | null;
	evFastLocalSharePct: number | null;
	climateEnergyKwh: number | null;
	climatePvKwh: number | null;
	climatePvSharePct: number | null;
	gridBalanceDischargeKwh: number | null;
	nonMonetized: {
		/** Gemessener elektrischer Energieeinsatz des Heizstabs; keine behauptete Pellet-Ersparnis. */
		thermalElectricalInputKwh: number | null;
		gridBalanceDischargeKwh: number | null;
		pelletReliefKwh: null;
		avoidedBoilerStarts: null;
		wearValueEur: null;
		notesDe: string[];
	};
	notesDe: string[];
	/** Reale Zählerdifferenz 1.8.0/2.8.0 ersetzt die rechnerische Netzintegration. */
	gridTruthSource?: "day_telemetry" | "smart_meter";
	meterCaptureSinceIso?: string | null;
}

/** Roll-up über einen auswählbaren Zeitraum; Prozentwerte sind energiemengengewichtet. */
export interface EnergeticPeriodSummary {
	period: string;
	periodLabelDe: string;
	fromKey: string;
	toKey: string;
	daysTotal: number;
	daysWithTelemetry: number;
	daysEvaluable: number;
	pvGenerationKwh: number | null;
	houseConsumptionKwh: number | null;
	gridImportKwh: number | null;
	gridExportKwh: number | null;
	selfConsumptionKwh: number | null;
	selfConsumptionPct: number | null;
	autonomyPct: number | null;
	/** Haus und Netz derselben vollständig gepaarten Messslots; null bei Datenlücken. */
	autonomyConsumptionBasisKwh?: number | null;
	autonomyGridImportBasisKwh?: number | null;
	batteryChargedKwh: number | null;
	batteryDischargedKwh: number | null;
	batteryPvChargedKwh: number | null;
	batteryPvSharePct: number | null;
	batteryMeasuredLossKwh: number | null;
	batteryStoredChangeKwh?: number | null;
	immersionEnergyKwh: number | null;
	immersionPvKwh: number | null;
	immersionPvSharePct: number | null;
	evChargedKwh: number | null;
	evPvKwh: number | null;
	evPvSharePct: number | null;
	evFastChargedKwh: number | null;
	evFastBatteryKwh: number | null;
	evFastBatterySharePct: number | null;
	evFastGridKwh: number | null;
	evFastGridSharePct: number | null;
	evFastLocalKwh: number | null;
	evFastLocalSharePct: number | null;
	climateEnergyKwh: number | null;
	climatePvKwh: number | null;
	climatePvSharePct: number | null;
	gridBalanceDischargeKwh: number | null;
	nonMonetized: EnergeticDayTotals["nonMonetized"];
	notesDe: string[];
}

export interface StatisticsDayRecord {
	dateKey: string;
	home: HomeDayTotals;
	mobility: MobilityDayTotals;
	publicSessions: PublicChargeSession[];
	/** Additiv und rückwärtskompatibel; alte Statistikdateien haben das Feld noch nicht. */
	energy?: EnergeticDayTotals | null;
}

export interface StatisticsPersist {
	version: typeof STATISTICS_PERSIST_VERSION;
	generatedAt: string;
	days: Record<string, StatisticsDayRecord>;
	/** Monats-Rewards aus Tibber-Abrechnung (adjust_request) — überschreibt HA-Schätzung. */
	monthRewardsBilling: Record<string, MonthRewardsBilling>;
	/** Laufende Integration innerhalb des Tages (nicht VIS). */
	runtime: {
		dateKey: string;
		lastTickMs: number | null;
		gridImportEnergyBaselineKwh: number | null;
		gridExportEnergyBaselineKwh: number | null;
		integratedDynamicCostEur: number;
		integratedGridImportKwhFromPower: number;
		wallboxSessionEnergyBaselineKwh: number | null;
		homePvKwh: number;
		homeGridKwh: number;
		homePvCostEur: number;
		homeGridCostEur: number;
		lastVehicleSocPct: number | null;
		lastWallboxConnected: boolean | null;
		meterCaptureSinceIso?: string | null;
	};
}

export interface HouseCompareSummary {
	period: string;
	periodLabelDe?: string;
	fromKey?: string;
	toKey?: string;
	gridImportKwh: number | null;
	gridExportKwh?: number | null;
	feedInCreditEur?: number | null;
	dynamicCostEur: number | null;
	fixedTariffCostEur: number | null;
	savingsVsFixedEur: number | null;
	gridRewardsCreditEur: number | null;
	gridRewardsSource: GridRewardsSource;
	reasonDe: string;
}

export interface MobilityCompareSummary {
	period: string;
	periodLabelDe?: string;
	fromKey?: string;
	toKey?: string;
	homePvKwh: number | null;
	/** Dieselbe gemessene Wallboxenergie wie in der energetischen Bilanz. */
	homeChargedKwh?: number | null;
	/** Nur wenn die zeitgleiche Quellenmessung diese Zuordnung belegt. */
	homeBatteryKwh?: number | null;
	homeGridKwh: number | null;
	homeGridCostEur: number | null;
	homeGridCostNetEur: number | null;
	gridRewardsSource: GridRewardsSource;
	publicInvoicedKwh: number | null;
	publicPendingKwh: number | null;
	evTotalCostEur: number | null;
	estimatedKm: number | null;
	iceCostEur: number | null;
	savingsVsIceEur: number | null;
	fuelPriceEurPerL: number | null;
	evKwhPer100Km: number | null;
	evKwhPer100KmSource: string | null;
	openPublicSessions: number;
	reasonDe: string;
}

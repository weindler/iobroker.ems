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

export interface StatisticsDayRecord {
	dateKey: string;
	home: HomeDayTotals;
	mobility: MobilityDayTotals;
	publicSessions: PublicChargeSession[];
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
	};
}

export interface HouseCompareSummary {
	period: string;
	periodLabelDe?: string;
	fromKey?: string;
	toKey?: string;
	gridImportKwh: number | null;
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

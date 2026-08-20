import { asBool, asNum } from "../ems_light/state_util";
import type { IceFuelType } from "./types";

function configRecord(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function strField(c: Record<string, unknown>, key: string, def = ""): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : def;
}

function boolField(c: Record<string, unknown>, key: string, def: boolean): boolean {
	const v = asBool(c[key]);
	return v === null ? def : v;
}

function numField(c: Record<string, unknown>, key: string, def: number | null): number | null {
	const n = asNum(c[key]);
	return n === null ? def : n;
}

function fuelType(raw: string): IceFuelType {
	const s = raw.trim().toLowerCase();
	if (s === "diesel") return "diesel";
	if (s === "e10") return "e10";
	return "e5";
}

export interface StatisticsAdminConfig {
	enabled: boolean;
	/** Vergleichstarif (Verivox-Stil) ct/kWh. */
	compareTariffCtPerKwh: number | null;
	compareTariffMonthlyBaseEur: number | null;
	/** Optional: Einspeisevergütung für Gutschrift — fallback feed_in_ct_per_kwh. */
	feedInCtPerKwh: number | null;
	/** Cumulative or daily energy counters (foreign). */
	gridImportEnergyKwhStateId: string;
	gridExportEnergyKwhStateId: string;
	/** Live grid import power W (foreign) for cost integration when no energy counter. */
	gridImportPowerWStateId: string;
	/** Optional Tibber/HA daily dynamic cost EUR. */
	dynamicCostTodayEurStateId: string;
	gridRewardsCreditEurStateId: string;
	/** Tankerkönig / HA Spritpreis €/l. */
	fuelPriceEurPerLStateId: string;
	fuelPriceFallbackEurPerL: number | null;
	iceFuelType: IceFuelType;
	iceLPer100Km: number | null;
	/** Ford Pass / Trip Log kWh/100 km. */
	evConsumptionKwhPer100StateId: string;
	evConsumptionFallbackKwhPer100: number | null;
	/** Wallbox session energy / price (reuse existing mapping keys when set). */
	wallboxSessionEnergyKwhStateId: string;
	wallboxSessionPricePerKwhStateId: string;
	wallboxConnectedStateId: string;
	vehicleSocPctStateId: string;
	externalVehicleChargeStateId: string;
	tibberGridRewardsActiveStateId: string;
}

export function statisticsConfigFromAdapter(config: unknown): StatisticsAdminConfig {
	const c = configRecord(config);
	const feedIn = numField(c, "feed_in_ct_per_kwh", null);
	return {
		enabled: boolField(c, "statistics_enabled", true),
		compareTariffCtPerKwh: numField(c, "statistics_compare_tariff_ct_per_kwh", null),
		compareTariffMonthlyBaseEur: numField(c, "statistics_compare_tariff_monthly_base_eur", 0),
		feedInCtPerKwh: numField(c, "statistics_feed_in_ct_per_kwh", feedIn),
		gridImportEnergyKwhStateId: strField(c, "statistics_grid_import_energy_kwh_state"),
		gridExportEnergyKwhStateId: strField(c, "statistics_grid_export_energy_kwh_state"),
		gridImportPowerWStateId: strField(c, "statistics_grid_import_power_w_state"),
		dynamicCostTodayEurStateId: strField(c, "statistics_dynamic_cost_today_eur_state"),
		gridRewardsCreditEurStateId: strField(c, "statistics_grid_rewards_credit_eur_state"),
		fuelPriceEurPerLStateId: strField(c, "statistics_fuel_price_eur_per_l_state"),
		fuelPriceFallbackEurPerL: numField(c, "statistics_fuel_price_fallback_eur_per_l", null),
		iceFuelType: fuelType(strField(c, "statistics_ice_fuel_type", "e5")),
		iceLPer100Km: numField(c, "statistics_ice_l_per_100km", null),
		evConsumptionKwhPer100StateId: strField(c, "statistics_ev_consumption_kwh_per_100_state"),
		evConsumptionFallbackKwhPer100: numField(c, "statistics_ev_consumption_fallback_kwh_per_100", null),
		wallboxSessionEnergyKwhStateId: strField(
			c,
			"statistics_wallbox_session_energy_kwh_state",
			strField(c, "wb_evcc_session_energy_kwh_state"),
		),
		wallboxSessionPricePerKwhStateId: strField(
			c,
			"statistics_wallbox_session_price_per_kwh_state",
			strField(c, "wb_evcc_session_price_per_kwh_state"),
		),
		wallboxConnectedStateId: strField(
			c,
			"statistics_wallbox_connected_state",
			strField(c, "wb_evcc_connected_state"),
		),
		vehicleSocPctStateId: strField(
			c,
			"statistics_vehicle_soc_pct_state",
			strField(c, "wb_evcc_vehicle_soc_pct_state"),
		),
		externalVehicleChargeStateId: strField(
			c,
			"statistics_external_vehicle_charge_state",
			strField(c, "wb_external_vehicle_charge_state"),
		),
		tibberGridRewardsActiveStateId: strField(
			c,
			"statistics_tibber_grid_rewards_active_state",
			strField(c, "wb_tibber_grid_rewards_active_state"),
		),
	};
}

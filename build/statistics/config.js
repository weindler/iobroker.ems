"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statisticsConfigFromAdapter = void 0;
const ensure_evcc_states_1 = require("../addons/wallbox/ensure_evcc_states");
const state_util_1 = require("../ems_light/state_util");
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function strField(c, key, def = "") {
    const v = c[key];
    return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : def;
}
function boolField(c, key, def) {
    const v = (0, state_util_1.asBool)(c[key]);
    return v === null ? def : v;
}
function numField(c, key, def) {
    const n = (0, state_util_1.asNum)(c[key]);
    return n === null ? def : n;
}
function fuelType(raw) {
    const s = raw.trim().toLowerCase();
    if (s === "diesel")
        return "diesel";
    if (s === "e10")
        return "e10";
    return "e5";
}
function statisticsConfigFromAdapter(config) {
    const c = configRecord(config);
    const feedIn = numField(c, "feed_in_ct_per_kwh", null);
    return {
        enabled: boolField(c, "statistics_enabled", true),
        compareTariffCtPerKwh: numField(c, "statistics_compare_tariff_ct_per_kwh", null),
        compareTariffMonthlyBaseEur: numField(c, "statistics_compare_tariff_monthly_base_eur", 0),
        tibberMonthlyBaseEur: numField(c, "tariff_monthly_base_eur", null),
        tibberMonthlyGridFeeEur: numField(c, "tariff_grid_fee_monthly_eur", null),
        feedInCtPerKwh: numField(c, "statistics_feed_in_ct_per_kwh", feedIn),
        gridImportEnergyKwhStateId: strField(c, "statistics_grid_import_energy_kwh_state"),
        gridExportEnergyKwhStateId: strField(c, "statistics_grid_export_energy_kwh_state"),
        gridImportPowerWStateId: strField(c, "statistics_grid_import_power_w_state"),
        dynamicCostTodayEurStateId: strField(c, "statistics_dynamic_cost_today_eur_state"),
        tibberJsonDailyStateId: strField(c, "statistics_tibber_json_daily_state"),
        gridImportMonthKwhStateId: strField(c, "statistics_grid_import_month_kwh_state"),
        dynamicCostMonthEurStateId: strField(c, "statistics_dynamic_cost_month_eur_state"),
        gridRewardsEnabled: boolField(c, "statistics_grid_rewards_enabled", false),
        gridRewardsCreditDayStateId: strField(c, "statistics_grid_rewards_credit_day_state") ||
            strField(c, "statistics_grid_rewards_credit_eur_state"),
        gridRewardsCreditMonthStateId: strField(c, "statistics_grid_rewards_credit_month_state"),
        statisticsStartDate: (() => {
            const s = strField(c, "statistics_start_date");
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        })(),
        fuelPriceEurPerLStateId: strField(c, "statistics_fuel_price_eur_per_l_state"),
        fuelPriceFallbackEurPerL: numField(c, "statistics_fuel_price_fallback_eur_per_l", null),
        iceFuelType: fuelType(strField(c, "statistics_ice_fuel_type", "e5")),
        iceLPer100Km: numField(c, "statistics_ice_l_per_100km", null),
        evConsumptionKwhPer100StateId: strField(c, "statistics_ev_consumption_kwh_per_100_state"),
        evConsumptionFallbackKwhPer100: numField(c, "statistics_ev_consumption_fallback_kwh_per_100", null),
        wallboxSessionEnergyKwhStateId: strField(c, "statistics_wallbox_session_energy_kwh_state") ||
            ensure_evcc_states_1.WALLBOX_EVCC_STATES.sessionEnergyKwh ||
            strField(c, "wb_evcc_session_energy_kwh_state"),
        wallboxSessionPricePerKwhStateId: strField(c, "statistics_wallbox_session_price_per_kwh_state", strField(c, "wb_evcc_session_price_per_kwh_state")),
        wallboxConnectedStateId: strField(c, "statistics_wallbox_connected_state", strField(c, "wb_evcc_connected_state")),
        vehicleSocPctStateId: strField(c, "statistics_vehicle_soc_pct_state", strField(c, "wb_evcc_vehicle_soc_pct_state")),
        externalVehicleChargeStateId: strField(c, "statistics_external_vehicle_charge_state", strField(c, "wb_external_vehicle_charge_state")),
        tibberGridRewardsActiveStateId: strField(c, "statistics_tibber_grid_rewards_active_state", strField(c, "wb_tibber_grid_rewards_active_state")),
    };
}
exports.statisticsConfigFromAdapter = statisticsConfigFromAdapter;

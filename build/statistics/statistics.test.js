"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const compute_js_1 = require("./compute.js");
const grid_rewards_js_1 = require("./grid_rewards.js");
const period_js_1 = require("./period.js");
const adjust_js_1 = require("./adjust.js");
const config_js_1 = require("./config.js");
const public_charge_js_1 = require("./public_charge.js");
(0, node_test_1.describe)("statistics compute", () => {
    (0, node_test_1.it)("fixed tariff cost matches Verivox-style energy + base share", () => {
        const cost = (0, compute_js_1.fixedTariffCostEur)({
            gridImportKwh: 10,
            compareTariffCtPerKwh: 30,
            monthlyBaseEur: 10,
            monthFraction: 1 / 30,
        });
        strict_1.default.equal(cost, 3.33);
    });
    (0, node_test_1.it)("Tibber day cost adds monthly Grundpreis + Netzentgelt as daily share", () => {
        const cost = (0, compute_js_1.tibberDayCostEur)({
            accumulatedCostEur: 0.1,
            monthlyBaseEur: 15.5,
            monthlyGridFeeEur: 15.5,
            monthFraction: 1 / 31,
        });
        // 0.1 + 15.5/31 + 15.5/31 ≈ 0.1 + 0.5 + 0.5 = 1.1
        strict_1.default.equal(cost, 1.1);
    });
    (0, node_test_1.it)("Tibber monthly fees come from Tarif-Tab natives; Verivox base stays in Statistik", () => {
        const cfg = (0, config_js_1.statisticsConfigFromAdapter)({
            statistics_compare_tariff_ct_per_kwh: 28,
            statistics_compare_tariff_monthly_base_eur: 12,
            tariff_monthly_base_eur: 5,
            tariff_grid_fee_monthly_eur: 8,
        });
        strict_1.default.equal(cfg.compareTariffMonthlyBaseEur, 12);
        strict_1.default.equal(cfg.tibberMonthlyBaseEur, 5);
        strict_1.default.equal(cfg.tibberMonthlyGridFeeEur, 8);
    });
    (0, node_test_1.it)("savings = fixed − (dynamic − rewards)", () => {
        strict_1.default.equal((0, compute_js_1.savingsVsFixedEur)(5, 3, 0.5), 2.5);
    });
    (0, node_test_1.it)("energy counter reset does not invent negative kWh", () => {
        const d = (0, compute_js_1.energyCounterDeltaKwh)(100, 2);
        strict_1.default.equal(d.deltaKwh, 0);
        strict_1.default.equal(d.newBaseline, 2);
    });
    (0, node_test_1.it)("converts EVCC sessionEnergy Wh to kWh for statistics", () => {
        strict_1.default.equal((0, compute_js_1.normalizeWallboxSessionEnergyKwh)("evcc.0.status.sessionEnergy", 854), 0.854);
        strict_1.default.equal((0, compute_js_1.normalizeWallboxSessionEnergyKwh)("ems.0.addons.wallbox.evcc.session_energy_kwh", 0.854), 0.854);
    });
    (0, node_test_1.it)("integrates import cost from power × Tibber", () => {
        const r = (0, compute_js_1.integrateImportCostEur)({
            importPowerW: 2000,
            priceCtPerKwh: 30,
            dtSec: 3600,
        });
        strict_1.default.equal(r.kwh, 2);
        strict_1.default.equal(r.costEur, 0.6);
    });
    (0, node_test_1.it)("prefers Ford/HA consumption over admin fallback", () => {
        strict_1.default.deepEqual((0, compute_js_1.resolveEvKwhPer100)({ mapped: 18, fallback: 20 }), {
            value: 18,
            source: "ford_hass",
        });
        strict_1.default.deepEqual((0, compute_js_1.resolveEvKwhPer100)({ mapped: null, fallback: 20 }), {
            value: 20,
            source: "admin_fallback",
        });
    });
    (0, node_test_1.it)("seed fuel price uses explicit value or admin fallback only", () => {
        strict_1.default.equal((0, compute_js_1.resolveSeedFuelPriceEurPerL)({ explicit: 1.82, fallback: 1.7 }), 1.82);
        strict_1.default.equal((0, compute_js_1.resolveSeedFuelPriceEurPerL)({ explicit: null, fallback: 1.85 }), 1.85);
        strict_1.default.equal((0, compute_js_1.resolveSeedFuelPriceEurPerL)({ explicit: null, fallback: null }), null);
    });
    (0, node_test_1.it)("ice cost from km × l/100 × fuel price", () => {
        const r = (0, compute_js_1.iceCostForKm)({ km: 100, lPer100Km: 7, fuelPriceEurPerL: 1.8 });
        strict_1.default.equal(r.liters, 7);
        strict_1.default.equal(r.costEur, 12.6);
    });
    (0, node_test_1.it)("Tibber jsonDaily sums current calendar month", () => {
        const raw = [
            { from: "2026-08-01T00:00:00+02:00", consumption: 10, totalCost: 2.5 },
            { to: "2026-08-15T00:00:00+02:00", consumption: 5.5, cost: 1.2 },
            { from: "2026-07-31T00:00:00+02:00", consumption: 99, totalCost: 99 },
        ];
        const r = (0, compute_js_1.sumTibberJsonDailyForMonth)(raw, "2026-08-28");
        strict_1.default.equal(r.gridImportKwh, 15.5);
        strict_1.default.equal(r.dynamicCostEur, 3.7);
    });
    (0, node_test_1.it)("resolveHomeMonthFromTibber falls back jsonMonthly then currentMonthConsumption", () => {
        const daily = (0, compute_js_1.resolveHomeMonthFromTibber)({
            dateKey: "2026-08-28",
            jsonDailyRaw: [],
            jsonMonthlyRaw: [{ from: "2026-08-01", consumption: 120, totalCost: 45 }],
            currentMonthKwh: 130,
            mappedMonthKwh: null,
            mappedMonthDynamicEur: null,
        });
        strict_1.default.equal(daily.source, "jsonMonthly");
        strict_1.default.equal(daily.gridImportKwh, 120);
        strict_1.default.equal(daily.addTibberFeesToDynamic, false);
        const fromJsonDaily = (0, compute_js_1.resolveHomeMonthFromTibber)({
            dateKey: "2026-08-28",
            jsonDailyRaw: [{ from: "2026-08-01", consumption: 1, totalCost: 0.5 }],
            jsonMonthlyRaw: [],
            currentMonthKwh: null,
            mappedMonthKwh: null,
            mappedMonthDynamicEur: null,
        });
        strict_1.default.equal(fromJsonDaily.addTibberFeesToDynamic, false);
        strict_1.default.equal(fromJsonDaily.dynamicCostEur, 0.5);
        const kwhOnly = (0, compute_js_1.resolveHomeMonthFromTibber)({
            dateKey: "2026-08-28",
            jsonDailyRaw: [],
            jsonMonthlyRaw: [],
            currentMonthKwh: 88.5,
            mappedMonthKwh: null,
            mappedMonthDynamicEur: null,
        });
        strict_1.default.equal(kwhOnly.source, "currentMonthConsumption");
        strict_1.default.equal(kwhOnly.gridImportKwh, 88.5);
    });
    (0, node_test_1.it)("buildHomeMonthTotals uses elapsed month fraction for fees", () => {
        const r = (0, compute_js_1.buildHomeMonthTotals)({
            dateKey: "2026-08-28",
            gridImportKwh: 100,
            dynamicCostEur: 30,
            gridRewardsCreditEur: 0,
            gridRewardsSource: "off",
            gridExportKwh: null,
            feedInCtPerKwh: null,
            compareTariffCtPerKwh: 30,
            compareTariffMonthlyBaseEur: 10,
            tibberMonthlyBaseEur: 5,
            tibberMonthlyGridFeeEur: 5,
            addTibberFeesToDynamic: true,
        });
        strict_1.default.ok((r.dynamicCostEur ?? 0) > 30);
        strict_1.default.ok((r.fixedTariffCostEur ?? 0) > 30);
        strict_1.default.notEqual(r.savingsVsFixedEur, null);
    });
    (0, node_test_1.it)("month mobility sums kWh/costs from seeded days without evTotalCostEur", () => {
        const month = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-11",
                homePvKwh: 1.5,
                homeGridKwh: 0.4,
                homePvCostEur: 0.19,
                homeGridCostEur: 0.06,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: null,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
            {
                dateKey: "2026-08-12",
                homePvKwh: 0.6,
                homeGridKwh: 8.2,
                homePvCostEur: 0.19,
                homeGridCostEur: 2.42,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: null,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
        ], {
            evKwhPer100: 18.3,
            fuelPriceEurPerL: 2.16,
            iceLPer100Km: 7,
            evKwhPer100KmSource: "ford_hass",
        });
        strict_1.default.equal(month.homeGridKwh, 8.6);
        strict_1.default.equal(month.evTotalCostEur, 2.86);
        strict_1.default.ok((month.estimatedKm ?? 0) > 50);
        strict_1.default.ok((month.iceCostEur ?? 0) > 5);
        strict_1.default.ok((month.savingsVsIceEur ?? 0) > 0);
    });
    (0, node_test_1.it)("month mobility mixes live day with evTotalCostEur and seeded days without", () => {
        const month = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-12",
                homePvKwh: 0.6,
                homeGridKwh: 8.2,
                homePvCostEur: 0.19,
                homeGridCostEur: 2.42,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: null,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
            {
                dateKey: "2026-08-28",
                homePvKwh: 0.6,
                homeGridKwh: 0.2,
                homePvCostEur: 0.08,
                homeGridCostEur: 0.03,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: 0.12,
                evKwhPer100Km: 18.3,
                evKwhPer100KmSource: "ford_hass",
                estimatedKm: 4.7,
                iceLiters: 0.33,
                iceFuelPriceEurPerL: 2.16,
                iceCostEur: 0.61,
                savingsVsIceEur: 0.49,
            },
        ], {
            evKwhPer100: 18.3,
            fuelPriceEurPerL: 2.16,
            iceLPer100Km: 7,
            evKwhPer100KmSource: "ford_hass",
        });
        strict_1.default.equal(month.evTotalCostEur, 2.73);
        strict_1.default.ok((month.estimatedKm ?? 0) > 45);
    });
    (0, node_test_1.it)("month mobility uses per-day fuel prices for ICE cost", () => {
        const month = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-11",
                homePvKwh: 1.5,
                homeGridKwh: 0.4,
                homePvCostEur: 0.19,
                homeGridCostEur: 0.06,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: 1.75,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
            {
                dateKey: "2026-08-12",
                homePvKwh: 0.6,
                homeGridKwh: 8.2,
                homePvCostEur: 0.19,
                homeGridCostEur: 2.42,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: 1.9,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
        ], {
            evKwhPer100: 18.3,
            fuelPriceEurPerL: 2.16,
            iceLPer100Km: 7,
            evKwhPer100KmSource: "ford_hass",
        });
        const singlePrice = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-11",
                homePvKwh: 1.5,
                homeGridKwh: 0.4,
                homePvCostEur: 0.19,
                homeGridCostEur: 0.06,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: 2.16,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
            {
                dateKey: "2026-08-12",
                homePvKwh: 0.6,
                homeGridKwh: 8.2,
                homePvCostEur: 0.19,
                homeGridCostEur: 2.42,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: null,
                gridRewardsSource: "off",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: null,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: 2.16,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
        ], {
            evKwhPer100: 18.3,
            fuelPriceEurPerL: 2.16,
            iceLPer100Km: 7,
            evKwhPer100KmSource: "ford_hass",
        });
        strict_1.default.notEqual(month.iceCostEur, singlePrice.iceCostEur);
        strict_1.default.ok((month.iceCostEur ?? 0) < (singlePrice.iceCostEur ?? 0));
    });
    (0, node_test_1.it)("grid rewards: month estimate mapping, billing overrides", () => {
        const estimate = (0, grid_rewards_js_1.resolveMonthGridRewards)({
            enabled: true,
            monthPrefix: "2026-08",
            billingCreditEur: null,
            mappedMonthEur: 1.2,
        });
        strict_1.default.equal(estimate.source, "estimate_month");
        strict_1.default.equal(estimate.creditEur, 1.2);
        const billing = (0, grid_rewards_js_1.resolveMonthGridRewards)({
            enabled: true,
            monthPrefix: "2026-08",
            billingCreditEur: 2.47,
            mappedMonthEur: 1.2,
        });
        strict_1.default.equal(billing.source, "billing");
        strict_1.default.equal(billing.creditEur, 2.47);
        strict_1.default.equal((0, grid_rewards_js_1.resolveTodayGridRewards)({ enabled: false, mappedDayEur: 1 }).source, "off");
        strict_1.default.equal((0, grid_rewards_js_1.resolveTodayGridRewards)({ enabled: true, mappedDayEur: 0 }).source, "off");
        strict_1.default.equal((0, grid_rewards_js_1.resolveTodayGridRewards)({ enabled: true, mappedDayEur: null }).source, "off");
        strict_1.default.equal((0, grid_rewards_js_1.gridRewardsCreditIsPresent)("estimate_day", 0), false);
        strict_1.default.equal((0, grid_rewards_js_1.gridRewardsCreditIsPresent)("estimate_day", 1.21), true);
        strict_1.default.equal((0, grid_rewards_js_1.gridRewardsCreditIsPresent)("billing", 0), true);
        strict_1.default.equal((0, grid_rewards_js_1.gridRewardsCreditIsPresent)("off", 0), false);
        const monthZero = (0, grid_rewards_js_1.resolveMonthGridRewards)({
            enabled: true,
            monthPrefix: "2026-08",
            billingCreditEur: null,
            mappedMonthEur: 0,
        });
        strict_1.default.equal(monthZero.source, "off");
        strict_1.default.equal(monthZero.creditEur, null);
        const billingZero = (0, grid_rewards_js_1.resolveMonthGridRewards)({
            enabled: true,
            monthPrefix: "2026-08",
            billingCreditEur: 0,
            mappedMonthEur: 1.2,
        });
        strict_1.default.equal(billingZero.source, "billing");
        strict_1.default.equal(billingZero.creditEur, 0);
        const periodNone = (0, grid_rewards_js_1.resolvePeriodGridRewards)({
            enabled: true,
            fromKey: "2026-08-01",
            toKey: "2026-08-31",
            todayKey: "2026-08-31",
            mappedMonthEur: 0,
            monthRewardsBilling: {},
            dayCredits: [{ dateKey: "2026-08-31", creditEur: null }],
        });
        strict_1.default.equal(periodNone.source, "off");
        strict_1.default.equal(periodNone.creditEur, null);
    });
    (0, node_test_1.it)("sumHomeDays setzt source=off wenn keine Rewards vorhanden sind (kein erfundenes estimate_day)", () => {
        const summed = (0, compute_js_1.sumHomeDays)([
            { ...(0, compute_js_1.emptyHomeDay)("2026-08-30"), gridImportKwh: 0.4, dynamicCostEur: 0.59, fixedTariffCostEur: 0.59 },
            { ...(0, compute_js_1.emptyHomeDay)("2026-08-31"), gridImportKwh: 0.2, dynamicCostEur: 0.3, fixedTariffCostEur: 0.3 },
        ]);
        strict_1.default.equal(summed.gridRewardsCreditEur, null);
        strict_1.default.equal(summed.gridRewardsSource, "off");
        strict_1.default.equal((0, grid_rewards_js_1.gridRewardsCreditIsPresent)(summed.gridRewardsSource, summed.gridRewardsCreditEur), false);
    });
    (0, node_test_1.it)("month mobility applies month rewards once from mapping", () => {
        const month = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-11",
                homePvKwh: 1,
                homeGridKwh: 5,
                homePvCostEur: 0.1,
                homeGridCostEur: 1.5,
                homeGridCostNetEur: null,
                gridRewardsCreditEur: 0.2,
                gridRewardsSource: "estimate_day",
                publicInvoicedKwh: null,
                publicInvoicedEur: null,
                publicPendingKwh: null,
                evTotalCostEur: 1.4,
                evKwhPer100Km: null,
                evKwhPer100KmSource: null,
                estimatedKm: null,
                iceLiters: null,
                iceFuelPriceEurPerL: null,
                iceCostEur: null,
                savingsVsIceEur: null,
            },
        ], {
            evKwhPer100: 18,
            fuelPriceEurPerL: 2,
            iceLPer100Km: 7,
            evKwhPer100KmSource: "admin_fallback",
        }, { creditEur: 0.8, source: "estimate_month" });
        strict_1.default.equal(month.gridRewardsCreditEur, 0.8);
        strict_1.default.equal(month.evTotalCostEur, 0.8);
        strict_1.default.equal((0, grid_rewards_js_1.netHomeGridCostEur)(1.5, 0.8), 0.7);
        strict_1.default.equal(month.homeGridCostNetEur, 0.7);
    });
});
(0, node_test_1.describe)("statistics period", () => {
    (0, node_test_1.it)("resolves last_7_days and this_month ranges", () => {
        const r7 = (0, period_js_1.resolvePeriodRange)("last_7_days", "2026-08-28");
        strict_1.default.equal(r7?.fromKey, "2026-08-22");
        strict_1.default.equal(r7?.toKey, "2026-08-28");
        const tm = (0, period_js_1.resolvePeriodRange)("this_month", "2026-08-28");
        strict_1.default.equal(tm?.fromKey, "2026-08-01");
        strict_1.default.equal(tm?.toKey, "2026-08-28");
        const lm = (0, period_js_1.resolvePeriodRange)("last_month", "2026-08-28");
        strict_1.default.equal(lm?.fromKey, "2026-07-01");
        strict_1.default.equal(lm?.toKey, "2026-07-31");
        const y = (0, period_js_1.resolvePeriodRange)("year_2025", "2026-08-28");
        strict_1.default.equal(y?.fromKey, "2025-01-01");
        strict_1.default.equal(y?.toKey, "2025-12-31");
        const opts = (0, period_js_1.listPeriodOptions)("2026-08-28", ["2025-01-01", "2026-08-01"]);
        strict_1.default.ok(opts.some((o) => o.id === "year_2025"));
        strict_1.default.ok(opts.some((o) => o.id === "this_quarter"));
        strict_1.default.deepEqual(opts.slice(0, 4).map((o) => o.id), ["today", "yesterday", "last_7_days", "this_month"]);
        strict_1.default.equal(opts[0]?.labelDe, "Heute");
        strict_1.default.equal(opts[1]?.labelDe, "Gestern");
        strict_1.default.equal((0, period_js_1.fixedTariffCostForRange)({
            gridImportKwh: 10,
            compareTariffCtPerKwh: 30,
            monthlyBaseEur: 31,
            fromKey: "2026-08-01",
            toKey: "2026-08-10",
        }), 13);
    });
    (0, node_test_1.it)("resolves today and yesterday as single-day ranges and does not fall back to this_month", () => {
        const today = (0, period_js_1.resolvePeriodRange)("today", "2026-08-28");
        strict_1.default.equal(today?.fromKey, "2026-08-28");
        strict_1.default.equal(today?.toKey, "2026-08-28");
        strict_1.default.equal(today?.labelDe, "Heute");
        const yesterday = (0, period_js_1.resolvePeriodRange)("yesterday", "2026-08-28");
        strict_1.default.equal(yesterday?.fromKey, "2026-08-27");
        strict_1.default.equal(yesterday?.toKey, "2026-08-27");
        strict_1.default.equal(yesterday?.labelDe, "Gestern");
        const nye = (0, period_js_1.resolvePeriodRange)("yesterday", "2026-01-01");
        strict_1.default.equal(nye?.fromKey, "2025-12-31");
        strict_1.default.equal((0, period_js_1.isValidPeriodId)("today"), true);
        strict_1.default.equal((0, period_js_1.isValidPeriodId)("yesterday"), true);
        strict_1.default.equal((0, period_js_1.normalizePeriodId)("today"), "today");
        strict_1.default.equal((0, period_js_1.normalizePeriodId)("yesterday"), "yesterday");
        strict_1.default.notEqual((0, period_js_1.normalizePeriodId)("today"), "this_month");
        const beforeStart = (0, period_js_1.clipPeriodRangeToStart)(yesterday, "2026-08-28");
        strict_1.default.equal(beforeStart, null, "Gestern vor Statistik-Start bleibt leer, kein anderer Zeitraum");
    });
    (0, node_test_1.it)("clips period to statistics start so Festtarif base is not inflated", () => {
        const year = (0, period_js_1.resolvePeriodRange)("this_year", "2026-08-28");
        strict_1.default.ok(year);
        const clipped = (0, period_js_1.clipPeriodRangeToStart)(year, "2026-08-01");
        strict_1.default.equal(clipped?.fromKey, "2026-08-01");
        strict_1.default.equal(clipped?.toKey, "2026-08-28");
        strict_1.default.match(clipped?.labelDe ?? "", /ab 2026-08-01/);
        const before = (0, period_js_1.clipPeriodRangeToStart)(year, "2027-01-01");
        strict_1.default.equal(before, null);
        strict_1.default.equal((0, period_js_1.resolveStatisticsStartKey)({
            adminStartKey: "2026-08-15",
            persistDayKeys: ["2026-08-01"],
            tibberEarliestKey: "2026-07-01",
        }), "2026-08-15");
        strict_1.default.equal((0, period_js_1.resolveStatisticsStartKey)({
            adminStartKey: null,
            persistDayKeys: ["2026-08-11", "2026-08-01"],
            tibberEarliestKey: "2026-08-05",
        }), "2026-08-01");
        const fixedYearInflated = (0, period_js_1.fixedTariffCostForRange)({
            gridImportKwh: 25.6,
            compareTariffCtPerKwh: 30,
            monthlyBaseEur: 12,
            fromKey: "2026-01-01",
            toKey: "2026-08-28",
        });
        const fixedFromInstall = (0, period_js_1.fixedTariffCostForRange)({
            gridImportKwh: 25.6,
            compareTariffCtPerKwh: 30,
            monthlyBaseEur: 12,
            fromKey: "2026-08-01",
            toKey: "2026-08-28",
        });
        strict_1.default.ok((fixedYearInflated ?? 0) > (fixedFromInstall ?? 0));
    });
});
(0, node_test_1.describe)("statistics public charge", () => {
    (0, node_test_1.it)("parses invoice submit and applies to latest pending", () => {
        const s = (0, public_charge_js_1.openPublicChargeSession)({
            nowIso: "2026-08-20T10:00:00.000Z",
            estimatedKwh: 40,
            fuelPriceEurPerLSnapshot: 1.7,
        });
        const parsed = (0, public_charge_js_1.parsePublicInvoiceSubmit)({ kwh: 38.2, eur: 22.5 });
        strict_1.default.ok(parsed);
        const out = (0, public_charge_js_1.applyPublicInvoice)([s], parsed, "2026-08-20T12:00:00.000Z");
        strict_1.default.match(out.ackDe, /Rechnung erfasst/);
        strict_1.default.equal(out.sessions[0].status, "invoiced");
        strict_1.default.equal(out.sessions[0].invoiceEur, 22.5);
    });
    (0, node_test_1.it)("rejects incomplete invoice", () => {
        const s = (0, public_charge_js_1.openPublicChargeSession)({
            nowIso: "2026-08-20T10:00:00.000Z",
            estimatedKwh: 40,
            fuelPriceEurPerLSnapshot: null,
        });
        const out = (0, public_charge_js_1.applyPublicInvoice)([s], { kwh: 40 }, "2026-08-20T12:00:00.000Z");
        strict_1.default.match(out.ackDe, /unvollständig/);
        strict_1.default.equal(out.sessions[0].status, "pending_invoice");
    });
});
(0, node_test_1.describe)("statistics adjust", () => {
    (0, node_test_1.it)("resetToday clears day and runtime", () => {
        const now = new Date("2026-08-28T14:00:00");
        const persist = {
            version: 1,
            generatedAt: "",
            monthRewardsBilling: {},
            days: {
                "2026-08-28": {
                    dateKey: "2026-08-28",
                    home: { dateKey: "2026-08-28", gridImportKwh: 999 },
                    mobility: { dateKey: "2026-08-28", homeGridKwh: 853 },
                    publicSessions: [],
                },
            },
            runtime: {
                dateKey: "2026-08-28",
                lastTickMs: 1,
                gridImportEnergyBaselineKwh: 1,
                gridExportEnergyBaselineKwh: null,
                integratedDynamicCostEur: 0,
                integratedGridImportKwhFromPower: 0,
                wallboxSessionEnergyBaselineKwh: 853,
                homePvKwh: 0,
                homeGridKwh: 853,
                homePvCostEur: 0,
                homeGridCostEur: 100,
                lastVehicleSocPct: null,
                lastWallboxConnected: null,
            },
        };
        const submit = (0, adjust_js_1.parseStatisticsAdjustSubmit)({ resetToday: true });
        strict_1.default.ok(submit);
        const out = (0, adjust_js_1.applyStatisticsAdjust)(persist, submit, now);
        strict_1.default.equal(out.persist.days["2026-08-28"], undefined);
        strict_1.default.equal(out.persist.runtime.homeGridKwh, 0);
        strict_1.default.match(out.ackDe, /zurückgesetzt/);
    });
    (0, node_test_1.it)("seeds mobility start values for today", () => {
        const now = new Date("2026-08-28T14:00:00");
        const persist = {
            version: 1,
            generatedAt: "",
            monthRewardsBilling: {},
            days: {},
            runtime: {
                dateKey: "2026-08-28",
                lastTickMs: null,
                gridImportEnergyBaselineKwh: null,
                gridExportEnergyBaselineKwh: null,
                integratedDynamicCostEur: 0,
                integratedGridImportKwhFromPower: 0,
                wallboxSessionEnergyBaselineKwh: 853,
                homePvKwh: 0,
                homeGridKwh: 853,
                homePvCostEur: 0,
                homeGridCostEur: 100,
                lastVehicleSocPct: null,
                lastWallboxConnected: null,
            },
        };
        const submit = (0, adjust_js_1.parseStatisticsAdjustSubmit)({
            mobility: { homeGridKwh: 0.854, homeGridCostEur: 0.12 },
        });
        strict_1.default.ok(submit);
        const out = (0, adjust_js_1.applyStatisticsAdjust)(persist, submit, now);
        strict_1.default.equal(out.persist.runtime.homeGridKwh, 0.854);
        strict_1.default.equal(out.persist.runtime.homeGridCostEur, 0.12);
        strict_1.default.equal(out.persist.runtime.wallboxSessionEnergyBaselineKwh, null);
    });
    (0, node_test_1.it)("seeds mobility with optional fuel price per day", () => {
        const now = new Date("2026-08-12T14:00:00");
        const persist = {
            version: 1,
            generatedAt: "",
            monthRewardsBilling: {},
            days: {},
            runtime: {
                dateKey: "2026-08-28",
                lastTickMs: null,
                gridImportEnergyBaselineKwh: null,
                gridExportEnergyBaselineKwh: null,
                integratedDynamicCostEur: 0,
                integratedGridImportKwhFromPower: 0,
                wallboxSessionEnergyBaselineKwh: null,
                homePvKwh: 0,
                homeGridKwh: 0,
                homePvCostEur: 0,
                homeGridCostEur: 0,
                lastVehicleSocPct: null,
                lastWallboxConnected: null,
            },
        };
        const submit = (0, adjust_js_1.parseStatisticsAdjustSubmit)({
            date: "2026-08-12",
            mobility: {
                homeGridKwh: 8.2,
                homeGridCostEur: 2.42,
                iceFuelPriceEurPerL: 1.82,
            },
        });
        strict_1.default.ok(submit);
        const out = (0, adjust_js_1.applyStatisticsAdjust)(persist, submit, now);
        strict_1.default.equal(out.persist.days["2026-08-12"]?.mobility.iceFuelPriceEurPerL, 1.82);
    });
    (0, node_test_1.it)("refresh triggers recalculate without data change", () => {
        const now = new Date("2026-08-28T14:00:00");
        const persist = {
            version: 1,
            generatedAt: "",
            monthRewardsBilling: {},
            days: {},
            runtime: {
                dateKey: "2026-08-28",
                lastTickMs: null,
                gridImportEnergyBaselineKwh: null,
                gridExportEnergyBaselineKwh: null,
                integratedDynamicCostEur: 0,
                integratedGridImportKwhFromPower: 0,
                wallboxSessionEnergyBaselineKwh: null,
                homePvKwh: 0,
                homeGridKwh: 0,
                homePvCostEur: 0,
                homeGridCostEur: 0,
                lastVehicleSocPct: null,
                lastWallboxConnected: null,
            },
        };
        const submit = (0, adjust_js_1.parseStatisticsAdjustSubmit)({ refresh: true });
        strict_1.default.ok(submit);
        strict_1.default.equal(submit.refresh, true);
        const out = (0, adjust_js_1.applyStatisticsAdjust)(persist, submit, now);
        strict_1.default.match(out.ackDe, /neu berechnet/);
    });
    (0, node_test_1.it)("stores month billing rewards from adjust_request", () => {
        const now = new Date("2026-08-31T20:00:00");
        const persist = {
            version: 1,
            generatedAt: "",
            monthRewardsBilling: {},
            days: {},
            runtime: {
                dateKey: "2026-08-31",
                lastTickMs: null,
                gridImportEnergyBaselineKwh: null,
                gridExportEnergyBaselineKwh: null,
                integratedDynamicCostEur: 0,
                integratedGridImportKwhFromPower: 0,
                wallboxSessionEnergyBaselineKwh: null,
                homePvKwh: 0,
                homeGridKwh: 0,
                homePvCostEur: 0,
                homeGridCostEur: 0,
                lastVehicleSocPct: null,
                lastWallboxConnected: null,
            },
        };
        const submit = (0, adjust_js_1.parseStatisticsAdjustSubmit)({
            date: "2026-08-31",
            home: { gridRewardsCreditEur: 2.47 },
            noteDe: "Tibber-Abrechnung August",
        });
        strict_1.default.ok(submit);
        const out = (0, adjust_js_1.applyStatisticsAdjust)(persist, submit, now);
        strict_1.default.equal(out.persist.monthRewardsBilling["2026-08"]?.creditEur, 2.47);
        strict_1.default.equal(out.persist.days["2026-08-31"]?.home.gridRewardsSource, "billing");
    });
});

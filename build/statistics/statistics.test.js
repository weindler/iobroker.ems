"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const compute_js_1 = require("./compute.js");
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
    (0, node_test_1.it)("month mobility sums kWh/costs from seeded days without evTotalCostEur", () => {
        const month = (0, compute_js_1.sumMobilityDays)([
            {
                dateKey: "2026-08-11",
                homePvKwh: 1.5,
                homeGridKwh: 0.4,
                homePvCostEur: 0.19,
                homeGridCostEur: 0.06,
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
                gridRewardsCreditEur: null,
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
});

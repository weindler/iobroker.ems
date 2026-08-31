import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	energyCounterDeltaKwh,
	fixedTariffCostEur,
	iceCostForKm,
	integrateImportCostEur,
	resolveEvKwhPer100,
	resolveFuelPriceEurPerL,
	resolveSeedFuelPriceEurPerL,
	savingsVsFixedEur,
	tibberDayCostEur,
	normalizeWallboxSessionEnergyKwh,
	sumMobilityDays,
	sumTibberJsonDailyForMonth,
	pickTibberJsonMonthlyForMonth,
	resolveHomeMonthFromTibber,
	siblingTibberConsumptionState,
	buildHomeMonthTotals,
	sumHomeDays,
	emptyHomeDay,
} from "./compute.js";
import {
	resolveMonthGridRewards,
	resolveTodayGridRewards,
	resolvePeriodGridRewards,
	netHomeGridCostEur,
	gridRewardsCreditIsPresent,
} from "./grid_rewards.js";
import {
	resolvePeriodRange,
	listPeriodOptions,
	fixedTariffCostForRange,
	clipPeriodRangeToStart,
	resolveStatisticsStartKey,
	isValidPeriodId,
	normalizePeriodId,
} from "./period.js";
import { applyStatisticsAdjust, parseStatisticsAdjustSubmit } from "./adjust.js";
import { statisticsConfigFromAdapter } from "./config.js";
import { applyPublicInvoice, openPublicChargeSession, parsePublicInvoiceSubmit } from "./public_charge.js";

describe("statistics compute", () => {
	it("fixed tariff cost matches Verivox-style energy + base share", () => {
		const cost = fixedTariffCostEur({
			gridImportKwh: 10,
			compareTariffCtPerKwh: 30,
			monthlyBaseEur: 10,
			monthFraction: 1 / 30,
		});
		assert.equal(cost, 3.33);
	});

	it("Tibber day cost adds monthly Grundpreis + Netzentgelt as daily share", () => {
		const cost = tibberDayCostEur({
			accumulatedCostEur: 0.1,
			monthlyBaseEur: 15.5,
			monthlyGridFeeEur: 15.5,
			monthFraction: 1 / 31,
		});
		// 0.1 + 15.5/31 + 15.5/31 ≈ 0.1 + 0.5 + 0.5 = 1.1
		assert.equal(cost, 1.1);
	});

	it("Tibber monthly fees come from Tarif-Tab natives; Verivox base stays in Statistik", () => {
		const cfg = statisticsConfigFromAdapter({
			statistics_compare_tariff_ct_per_kwh: 28,
			statistics_compare_tariff_monthly_base_eur: 12,
			tariff_monthly_base_eur: 5,
			tariff_grid_fee_monthly_eur: 8,
		});
		assert.equal(cfg.compareTariffMonthlyBaseEur, 12);
		assert.equal(cfg.tibberMonthlyBaseEur, 5);
		assert.equal(cfg.tibberMonthlyGridFeeEur, 8);
	});

	it("savings = fixed − (dynamic − rewards)", () => {
		assert.equal(savingsVsFixedEur(5, 3, 0.5), 2.5);
	});

	it("energy counter reset does not invent negative kWh", () => {
		const d = energyCounterDeltaKwh(100, 2);
		assert.equal(d.deltaKwh, 0);
		assert.equal(d.newBaseline, 2);
	});

	it("converts EVCC sessionEnergy Wh to kWh for statistics", () => {
		assert.equal(
			normalizeWallboxSessionEnergyKwh("evcc.0.status.sessionEnergy", 854),
			0.854,
		);
		assert.equal(
			normalizeWallboxSessionEnergyKwh(
				"ems.0.addons.wallbox.evcc.session_energy_kwh",
				0.854,
			),
			0.854,
		);
	});

	it("integrates import cost from power × Tibber", () => {
		const r = integrateImportCostEur({
			importPowerW: 2000,
			priceCtPerKwh: 30,
			dtSec: 3600,
		});
		assert.equal(r.kwh, 2);
		assert.equal(r.costEur, 0.6);
	});

	it("prefers Ford/HA consumption over admin fallback", () => {
		assert.deepEqual(resolveEvKwhPer100({ mapped: 18, fallback: 20 }), {
			value: 18,
			source: "ford_hass",
		});
		assert.deepEqual(resolveEvKwhPer100({ mapped: null, fallback: 20 }), {
			value: 20,
			source: "admin_fallback",
		});
	});

	it("seed fuel price uses explicit value or admin fallback only", () => {
		assert.equal(resolveSeedFuelPriceEurPerL({ explicit: 1.82, fallback: 1.7 }), 1.82);
		assert.equal(resolveSeedFuelPriceEurPerL({ explicit: null, fallback: 1.85 }), 1.85);
		assert.equal(resolveSeedFuelPriceEurPerL({ explicit: null, fallback: null }), null);
	});

	it("ice cost from km × l/100 × fuel price", () => {
		const r = iceCostForKm({ km: 100, lPer100Km: 7, fuelPriceEurPerL: 1.8 });
		assert.equal(r.liters, 7);
		assert.equal(r.costEur, 12.6);
	});

	it("Tibber jsonDaily sums current calendar month", () => {
		const raw = [
			{ from: "2026-08-01T00:00:00+02:00", consumption: 10, totalCost: 2.5 },
			{ to: "2026-08-15T00:00:00+02:00", consumption: 5.5, cost: 1.2 },
			{ from: "2026-07-31T00:00:00+02:00", consumption: 99, totalCost: 99 },
		];
		const r = sumTibberJsonDailyForMonth(raw, "2026-08-28");
		assert.equal(r.gridImportKwh, 15.5);
		assert.equal(r.dynamicCostEur, 3.7);
	});

	it("resolveHomeMonthFromTibber falls back jsonMonthly then currentMonthConsumption", () => {
		const daily = resolveHomeMonthFromTibber({
			dateKey: "2026-08-28",
			jsonDailyRaw: [],
			jsonMonthlyRaw: [{ from: "2026-08-01", consumption: 120, totalCost: 45 }],
			currentMonthKwh: 130,
			mappedMonthKwh: null,
			mappedMonthDynamicEur: null,
		});
		assert.equal(daily.source, "jsonMonthly");
		assert.equal(daily.gridImportKwh, 120);
		assert.equal(daily.addTibberFeesToDynamic, false);

		const fromJsonDaily = resolveHomeMonthFromTibber({
			dateKey: "2026-08-28",
			jsonDailyRaw: [{ from: "2026-08-01", consumption: 1, totalCost: 0.5 }],
			jsonMonthlyRaw: [],
			currentMonthKwh: null,
			mappedMonthKwh: null,
			mappedMonthDynamicEur: null,
		});
		assert.equal(fromJsonDaily.addTibberFeesToDynamic, false);
		assert.equal(fromJsonDaily.dynamicCostEur, 0.5);

		const kwhOnly = resolveHomeMonthFromTibber({
			dateKey: "2026-08-28",
			jsonDailyRaw: [],
			jsonMonthlyRaw: [],
			currentMonthKwh: 88.5,
			mappedMonthKwh: null,
			mappedMonthDynamicEur: null,
		});
		assert.equal(kwhOnly.source, "currentMonthConsumption");
		assert.equal(kwhOnly.gridImportKwh, 88.5);
	});

	it("buildHomeMonthTotals uses elapsed month fraction for fees", () => {
		const r = buildHomeMonthTotals({
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
		assert.ok((r.dynamicCostEur ?? 0) > 30);
		assert.ok((r.fixedTariffCostEur ?? 0) > 30);
		assert.notEqual(r.savingsVsFixedEur, null);
	});

	it("month mobility sums kWh/costs from seeded days without evTotalCostEur", () => {
		const month = sumMobilityDays(
			[
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
			],
			{
				evKwhPer100: 18.3,
				fuelPriceEurPerL: 2.16,
				iceLPer100Km: 7,
				evKwhPer100KmSource: "ford_hass",
			},
		);
		assert.equal(month.homeGridKwh, 8.6);
		assert.equal(month.evTotalCostEur, 2.86);
		assert.ok((month.estimatedKm ?? 0) > 50);
		assert.ok((month.iceCostEur ?? 0) > 5);
		assert.ok((month.savingsVsIceEur ?? 0) > 0);
	});

	it("month mobility mixes live day with evTotalCostEur and seeded days without", () => {
		const month = sumMobilityDays(
			[
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
			],
			{
				evKwhPer100: 18.3,
				fuelPriceEurPerL: 2.16,
				iceLPer100Km: 7,
				evKwhPer100KmSource: "ford_hass",
			},
		);
		assert.equal(month.evTotalCostEur, 2.73);
		assert.ok((month.estimatedKm ?? 0) > 45);
	});

	it("month mobility uses per-day fuel prices for ICE cost", () => {
		const month = sumMobilityDays(
			[
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
			],
			{
				evKwhPer100: 18.3,
				fuelPriceEurPerL: 2.16,
				iceLPer100Km: 7,
				evKwhPer100KmSource: "ford_hass",
			},
		);
		const singlePrice = sumMobilityDays(
			[
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
			],
			{
				evKwhPer100: 18.3,
				fuelPriceEurPerL: 2.16,
				iceLPer100Km: 7,
				evKwhPer100KmSource: "ford_hass",
			},
		);
		assert.notEqual(month.iceCostEur, singlePrice.iceCostEur);
		assert.ok((month.iceCostEur ?? 0) < (singlePrice.iceCostEur ?? 0));
	});

	it("grid rewards: month estimate mapping, billing overrides", () => {
		const estimate = resolveMonthGridRewards({
			enabled: true,
			monthPrefix: "2026-08",
			billingCreditEur: null,
			mappedMonthEur: 1.2,
		});
		assert.equal(estimate.source, "estimate_month");
		assert.equal(estimate.creditEur, 1.2);

		const billing = resolveMonthGridRewards({
			enabled: true,
			monthPrefix: "2026-08",
			billingCreditEur: 2.47,
			mappedMonthEur: 1.2,
		});
		assert.equal(billing.source, "billing");
		assert.equal(billing.creditEur, 2.47);

		assert.equal(
			resolveTodayGridRewards({ enabled: false, mappedDayEur: 1 }).source,
			"off",
		);

		assert.equal(resolveTodayGridRewards({ enabled: true, mappedDayEur: 0 }).source, "off");
		assert.equal(resolveTodayGridRewards({ enabled: true, mappedDayEur: null }).source, "off");
		assert.equal(gridRewardsCreditIsPresent("estimate_day", 0), false);
		assert.equal(gridRewardsCreditIsPresent("estimate_day", 1.21), true);
		assert.equal(gridRewardsCreditIsPresent("billing", 0), true);
		assert.equal(gridRewardsCreditIsPresent("off", 0), false);

		const monthZero = resolveMonthGridRewards({
			enabled: true,
			monthPrefix: "2026-08",
			billingCreditEur: null,
			mappedMonthEur: 0,
		});
		assert.equal(monthZero.source, "off");
		assert.equal(monthZero.creditEur, null);

		const billingZero = resolveMonthGridRewards({
			enabled: true,
			monthPrefix: "2026-08",
			billingCreditEur: 0,
			mappedMonthEur: 1.2,
		});
		assert.equal(billingZero.source, "billing");
		assert.equal(billingZero.creditEur, 0);

		const periodNone = resolvePeriodGridRewards({
			enabled: true,
			fromKey: "2026-08-01",
			toKey: "2026-08-31",
			todayKey: "2026-08-31",
			mappedMonthEur: 0,
			monthRewardsBilling: {},
			dayCredits: [{ dateKey: "2026-08-31", creditEur: null }],
		});
		assert.equal(periodNone.source, "off");
		assert.equal(periodNone.creditEur, null);
	});

	it("sumHomeDays setzt source=off wenn keine Rewards vorhanden sind (kein erfundenes estimate_day)", () => {
		const summed = sumHomeDays([
			{ ...emptyHomeDay("2026-08-30"), gridImportKwh: 0.4, dynamicCostEur: 0.59, fixedTariffCostEur: 0.59 },
			{ ...emptyHomeDay("2026-08-31"), gridImportKwh: 0.2, dynamicCostEur: 0.3, fixedTariffCostEur: 0.3 },
		]);
		assert.equal(summed.gridRewardsCreditEur, null);
		assert.equal(summed.gridRewardsSource, "off");
		assert.equal(gridRewardsCreditIsPresent(summed.gridRewardsSource, summed.gridRewardsCreditEur), false);
	});

	it("month mobility applies month rewards once from mapping", () => {
		const month = sumMobilityDays(
			[
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
			],
			{
				evKwhPer100: 18,
				fuelPriceEurPerL: 2,
				iceLPer100Km: 7,
				evKwhPer100KmSource: "admin_fallback",
			},
			{ creditEur: 0.8, source: "estimate_month" },
		);
		assert.equal(month.gridRewardsCreditEur, 0.8);
		assert.equal(month.evTotalCostEur, 0.8);
		assert.equal(netHomeGridCostEur(1.5, 0.8), 0.7);
		assert.equal(month.homeGridCostNetEur, 0.7);
	});
});

describe("statistics period", () => {
	it("resolves last_7_days and this_month ranges", () => {
		const r7 = resolvePeriodRange("last_7_days", "2026-08-28");
		assert.equal(r7?.fromKey, "2026-08-22");
		assert.equal(r7?.toKey, "2026-08-28");
		const tm = resolvePeriodRange("this_month", "2026-08-28");
		assert.equal(tm?.fromKey, "2026-08-01");
		assert.equal(tm?.toKey, "2026-08-28");
		const lm = resolvePeriodRange("last_month", "2026-08-28");
		assert.equal(lm?.fromKey, "2026-07-01");
		assert.equal(lm?.toKey, "2026-07-31");
		const y = resolvePeriodRange("year_2025", "2026-08-28");
		assert.equal(y?.fromKey, "2025-01-01");
		assert.equal(y?.toKey, "2025-12-31");
		const opts = listPeriodOptions("2026-08-28", ["2025-01-01", "2026-08-01"]);
		assert.ok(opts.some((o) => o.id === "year_2025"));
		assert.ok(opts.some((o) => o.id === "this_quarter"));
		assert.deepEqual(
			opts.slice(0, 4).map((o) => o.id),
			["today", "yesterday", "last_7_days", "this_month"],
		);
		assert.equal(opts[0]?.labelDe, "Heute");
		assert.equal(opts[1]?.labelDe, "Gestern");
		assert.equal(
			fixedTariffCostForRange({
				gridImportKwh: 10,
				compareTariffCtPerKwh: 30,
				monthlyBaseEur: 31,
				fromKey: "2026-08-01",
				toKey: "2026-08-10",
			}),
			13, // 3.0 energy + 10/31*31 = 10 → 13
		);
	});

	it("resolves today and yesterday as single-day ranges and does not fall back to this_month", () => {
		const today = resolvePeriodRange("today", "2026-08-28");
		assert.equal(today?.fromKey, "2026-08-28");
		assert.equal(today?.toKey, "2026-08-28");
		assert.equal(today?.labelDe, "Heute");
		const yesterday = resolvePeriodRange("yesterday", "2026-08-28");
		assert.equal(yesterday?.fromKey, "2026-08-27");
		assert.equal(yesterday?.toKey, "2026-08-27");
		assert.equal(yesterday?.labelDe, "Gestern");
		const nye = resolvePeriodRange("yesterday", "2026-01-01");
		assert.equal(nye?.fromKey, "2025-12-31");
		assert.equal(isValidPeriodId("today"), true);
		assert.equal(isValidPeriodId("yesterday"), true);
		assert.equal(normalizePeriodId("today"), "today");
		assert.equal(normalizePeriodId("yesterday"), "yesterday");
		assert.notEqual(normalizePeriodId("today"), "this_month");
		const beforeStart = clipPeriodRangeToStart(yesterday!, "2026-08-28");
		assert.equal(beforeStart, null, "Gestern vor Statistik-Start bleibt leer, kein anderer Zeitraum");
	});

	it("clips period to statistics start so Festtarif base is not inflated", () => {
		const year = resolvePeriodRange("this_year", "2026-08-28");
		assert.ok(year);
		const clipped = clipPeriodRangeToStart(year!, "2026-08-01");
		assert.equal(clipped?.fromKey, "2026-08-01");
		assert.equal(clipped?.toKey, "2026-08-28");
		assert.match(clipped?.labelDe ?? "", /ab 2026-08-01/);
		const before = clipPeriodRangeToStart(year!, "2027-01-01");
		assert.equal(before, null);
		assert.equal(
			resolveStatisticsStartKey({
				adminStartKey: "2026-08-15",
				persistDayKeys: ["2026-08-01"],
				tibberEarliestKey: "2026-07-01",
			}),
			"2026-08-15",
		);
		assert.equal(
			resolveStatisticsStartKey({
				adminStartKey: null,
				persistDayKeys: ["2026-08-11", "2026-08-01"],
				tibberEarliestKey: "2026-08-05",
			}),
			"2026-08-01",
		);
		const fixedYearInflated = fixedTariffCostForRange({
			gridImportKwh: 25.6,
			compareTariffCtPerKwh: 30,
			monthlyBaseEur: 12,
			fromKey: "2026-01-01",
			toKey: "2026-08-28",
		});
		const fixedFromInstall = fixedTariffCostForRange({
			gridImportKwh: 25.6,
			compareTariffCtPerKwh: 30,
			monthlyBaseEur: 12,
			fromKey: "2026-08-01",
			toKey: "2026-08-28",
		});
		assert.ok((fixedYearInflated ?? 0) > (fixedFromInstall ?? 0));
	});
});

describe("statistics public charge", () => {
	it("parses invoice submit and applies to latest pending", () => {
		const s = openPublicChargeSession({
			nowIso: "2026-08-20T10:00:00.000Z",
			estimatedKwh: 40,
			fuelPriceEurPerLSnapshot: 1.7,
		});
		const parsed = parsePublicInvoiceSubmit({ kwh: 38.2, eur: 22.5 });
		assert.ok(parsed);
		const out = applyPublicInvoice([s], parsed!, "2026-08-20T12:00:00.000Z");
		assert.match(out.ackDe, /Rechnung erfasst/);
		assert.equal(out.sessions[0]!.status, "invoiced");
		assert.equal(out.sessions[0]!.invoiceEur, 22.5);
	});

	it("rejects incomplete invoice", () => {
		const s = openPublicChargeSession({
			nowIso: "2026-08-20T10:00:00.000Z",
			estimatedKwh: 40,
			fuelPriceEurPerLSnapshot: null,
		});
		const out = applyPublicInvoice([s], { kwh: 40 }, "2026-08-20T12:00:00.000Z");
		assert.match(out.ackDe, /unvollständig/);
		assert.equal(out.sessions[0]!.status, "pending_invoice");
	});
});

describe("statistics adjust", () => {
	it("resetToday clears day and runtime", () => {
		const now = new Date("2026-08-28T14:00:00");
		const persist = {
			version: 1 as const,
			generatedAt: "",
			monthRewardsBilling: {},
			days: {
				"2026-08-28": {
					dateKey: "2026-08-28",
					home: { dateKey: "2026-08-28", gridImportKwh: 999 } as never,
					mobility: { dateKey: "2026-08-28", homeGridKwh: 853 } as never,
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
		const submit = parseStatisticsAdjustSubmit({ resetToday: true });
		assert.ok(submit);
		const out = applyStatisticsAdjust(persist, submit!, now);
		assert.equal(out.persist.days["2026-08-28"], undefined);
		assert.equal(out.persist.runtime.homeGridKwh, 0);
		assert.match(out.ackDe, /zurückgesetzt/);
	});

	it("seeds mobility start values for today", () => {
		const now = new Date("2026-08-28T14:00:00");
		const persist = {
			version: 1 as const,
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
		const submit = parseStatisticsAdjustSubmit({
			mobility: { homeGridKwh: 0.854, homeGridCostEur: 0.12 },
		});
		assert.ok(submit);
		const out = applyStatisticsAdjust(persist, submit!, now);
		assert.equal(out.persist.runtime.homeGridKwh, 0.854);
		assert.equal(out.persist.runtime.homeGridCostEur, 0.12);
		assert.equal(out.persist.runtime.wallboxSessionEnergyBaselineKwh, null);
	});

	it("seeds mobility with optional fuel price per day", () => {
		const now = new Date("2026-08-12T14:00:00");
		const persist = {
			version: 1 as const,
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
		const submit = parseStatisticsAdjustSubmit({
			date: "2026-08-12",
			mobility: {
				homeGridKwh: 8.2,
				homeGridCostEur: 2.42,
				iceFuelPriceEurPerL: 1.82,
			},
		});
		assert.ok(submit);
		const out = applyStatisticsAdjust(persist, submit!, now);
		assert.equal(out.persist.days["2026-08-12"]?.mobility.iceFuelPriceEurPerL, 1.82);
	});

	it("refresh triggers recalculate without data change", () => {
		const now = new Date("2026-08-28T14:00:00");
		const persist = {
			version: 1 as const,
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
		const submit = parseStatisticsAdjustSubmit({ refresh: true });
		assert.ok(submit);
		assert.equal(submit!.refresh, true);
		const out = applyStatisticsAdjust(persist, submit!, now);
		assert.match(out.ackDe, /neu berechnet/);
	});

	it("stores month billing rewards from adjust_request", () => {
		const now = new Date("2026-08-31T20:00:00");
		const persist = {
			version: 1 as const,
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
		const submit = parseStatisticsAdjustSubmit({
			date: "2026-08-31",
			home: { gridRewardsCreditEur: 2.47 },
			noteDe: "Tibber-Abrechnung August",
		});
		assert.ok(submit);
		const out = applyStatisticsAdjust(persist, submit!, now);
		assert.equal(out.persist.monthRewardsBilling["2026-08"]?.creditEur, 2.47);
		assert.equal(out.persist.days["2026-08-31"]?.home.gridRewardsSource, "billing");
	});
});

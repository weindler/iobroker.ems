import { asBool, asNum } from "../ems_light/state_util";
import { statisticsConfigFromAdapter, type StatisticsAdminConfig } from "./config";
import {
	daysInMonth,
	energyCounterDeltaKwh,
	estimateKwhFromSocRise,
	estimateKmFromEvKwh,
	dailyBaseShareEur,
	fixedTariffCostEur,
	finalizeMobilityDayTotals,
	tibberDayCostEur,
	iceCostForKm,
	integrateImportCostEur,
	localDateKey,
	normalizeWallboxSessionEnergyKwh,
	resolveEvKwhPer100,
	resolveFuelPriceEurPerL,
	resolveSeedFuelPriceEurPerL,
	savingsVsFixedEur,
	sumHomeDays,
	sumMobilityDays,
} from "./compute";
import { STATISTICS_STATES } from "./ensure_states";
import {
	emptyDayRecord,
	emptyPersist,
	emptyRuntime,
	readStatisticsPersist,
	STATISTICS_PERSIST_CATEGORY,
	writeStatisticsPersist,
} from "./persist";
import {
	applyPublicInvoice,
	invoicedPublicTotals,
	openPublicChargeSession,
	parsePublicInvoiceSubmit,
	pendingPublicKwh,
} from "./public_charge";
import { applyStatisticsAdjust, parseStatisticsAdjustSubmit } from "./adjust";
import type {
	HouseCompareSummary,
	MobilityCompareSummary,
	StatisticsDayRecord,
	StatisticsPersist,
} from "./types";

export type StatisticsHost = {
	config: unknown;
	namespace?: string;
	getAbsolutePath?: (category?: string) => string;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
};

async function setIfChanged(
	host: StatisticsHost,
	id: string,
	val: ioBroker.StateValue,
): Promise<void> {
	const cur = await host.getStateAsync(id);
	if (cur?.val === val) return;
	await host.setStateAsync(id, { val, ack: true });
}

let persistCache: StatisticsPersist | null = null;
let persistDirty = false;

function baseDir(host: StatisticsHost): string | null {
	return typeof host.getAbsolutePath === "function"
		? host.getAbsolutePath(STATISTICS_PERSIST_CATEGORY)
		: null;
}

async function loadPersist(host: StatisticsHost): Promise<StatisticsPersist> {
	if (persistCache) return persistCache;
	const dir = baseDir(host);
	if (!dir) {
		persistCache = emptyPersist();
		return persistCache;
	}
	persistCache = await readStatisticsPersist(dir);
	return persistCache;
}

async function flushPersist(host: StatisticsHost): Promise<void> {
	if (!persistDirty || !persistCache) return;
	const dir = baseDir(host);
	if (!dir) return;
	await writeStatisticsPersist(dir, persistCache);
	persistDirty = false;
}

async function readForeignNum(host: StatisticsHost, id: string): Promise<number | null> {
	if (!id) return null;
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		return asNum((await reader(id))?.val);
	} catch {
		return null;
	}
}

async function readForeignBool(host: StatisticsHost, id: string): Promise<boolean | null> {
	if (!id) return null;
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		return asBool((await reader(id))?.val);
	} catch {
		return null;
	}
}

async function readForeignRaw(host: StatisticsHost, id: string): Promise<unknown> {
	if (!id) return null;
	try {
		const reader = host.getForeignStateAsync ?? host.getStateAsync;
		return (await reader(id))?.val ?? null;
	} catch {
		return null;
	}
}

function monthKeys(dateKey: string, days: Record<string, StatisticsDayRecord>): string[] {
	const prefix = dateKey.slice(0, 7);
	return Object.keys(days)
		.filter((k) => k.startsWith(prefix))
		.sort();
}

function buildHomeSummary(
	period: "today" | "month",
	home: StatisticsDayRecord["home"],
	reasonParts: string[],
): HouseCompareSummary {
	return {
		period,
		gridImportKwh: home.gridImportKwh,
		dynamicCostEur: home.dynamicCostEur,
		fixedTariffCostEur: home.fixedTariffCostEur,
		savingsVsFixedEur: home.savingsVsFixedEur,
		gridRewardsCreditEur: home.gridRewardsCreditEur,
		reasonDe: reasonParts.join(" ") || "—",
	};
}

function buildMobilitySummary(
	period: "today" | "month",
	mob: StatisticsDayRecord["mobility"],
	openSessions: number,
	reasonParts: string[],
): MobilityCompareSummary {
	return {
		period,
		homePvKwh: mob.homePvKwh,
		homeGridKwh: mob.homeGridKwh,
		publicInvoicedKwh: mob.publicInvoicedKwh,
		publicPendingKwh: mob.publicPendingKwh,
		evTotalCostEur: mob.evTotalCostEur,
		estimatedKm: mob.estimatedKm,
		iceCostEur: mob.iceCostEur,
		savingsVsIceEur: mob.savingsVsIceEur,
		fuelPriceEurPerL: mob.iceFuelPriceEurPerL,
		evKwhPer100Km: mob.evKwhPer100Km,
		evKwhPer100KmSource: mob.evKwhPer100KmSource,
		openPublicSessions: openSessions,
		reasonDe: reasonParts.join(" ") || "—",
	};
}

function ensureDay(persist: StatisticsPersist, dateKey: string): StatisticsDayRecord {
	if (!persist.days[dateKey]) {
		persist.days[dateKey] = emptyDayRecord(dateKey);
		persistDirty = true;
	}
	return persist.days[dateKey]!;
}

function rolloverRuntimeIfNeeded(persist: StatisticsPersist, dateKey: string): void {
	if (persist.runtime.dateKey === dateKey) return;
	persist.runtime = emptyRuntime(dateKey);
	persistDirty = true;
}

async function handlePublicSubmit(host: StatisticsHost, persist: StatisticsPersist, now: Date): Promise<void> {
	const st = await host.getStateAsync(STATISTICS_STATES.publicSubmitRequest);
	if (!st || st.ack === true) return;
	const submit = parsePublicInvoiceSubmit(st.val);
	await host.setStateAsync(STATISTICS_STATES.publicSubmitRequest, { val: "", ack: true });
	if (!submit) {
		await setIfChanged(host, STATISTICS_STATES.publicSubmitAckDe, "Ungültiges JSON.");
		return;
	}
	const dateKey = localDateKey(now);
	const day = ensureDay(persist, dateKey);
	const result = applyPublicInvoice(day.publicSessions, submit, now.toISOString());
	day.publicSessions = result.sessions;
	persistDirty = true;
	await setIfChanged(host, STATISTICS_STATES.publicSubmitAckDe, result.ackDe);
	host.log?.info?.(`statistics public charge: ${result.ackDe}`);
}

async function recalculateMonthMobilityDays(
	host: StatisticsHost,
	persist: StatisticsPersist,
	now: Date,
	cfg: StatisticsAdminConfig,
	refDateKey?: string,
): Promise<void> {
	const refKey = refDateKey ?? localDateKey(now);
	const evConsMapped = await readForeignNum(host, cfg.evConsumptionKwhPer100StateId);
	const evCons = resolveEvKwhPer100({
		mapped: evConsMapped,
		fallback: cfg.evConsumptionFallbackKwhPer100,
	});
	for (const key of monthKeys(refKey, persist.days)) {
		const day = persist.days[key];
		if (!day) continue;
		const mob = day.mobility;
		const chargeKwh =
			(mob.homePvKwh ?? 0) + (mob.homeGridKwh ?? 0) + (mob.publicInvoicedKwh ?? 0);
		if (chargeKwh <= 0 && !(mob.publicInvoicedEur ?? 0)) continue;
		const fuelPrice = resolveSeedFuelPriceEurPerL({
			explicit: mob.iceFuelPriceEurPerL,
			fallback: cfg.fuelPriceFallbackEurPerL,
		});
		finalizeMobilityDayTotals(mob, {
			evKwhPer100: evCons.value,
			fuelPriceEurPerL: fuelPrice,
			iceLPer100Km: cfg.iceLPer100Km,
			evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
		});
	}
}

async function handleAdjustSubmit(
	host: StatisticsHost,
	persist: StatisticsPersist,
	now: Date,
	cfg: StatisticsAdminConfig,
): Promise<void> {
	const st = await host.getStateAsync(STATISTICS_STATES.adjustRequest);
	if (!st || st.ack === true) return;
	const submit = parseStatisticsAdjustSubmit(st.val);
	await host.setStateAsync(STATISTICS_STATES.adjustRequest, { val: "", ack: true });
	if (!submit) {
		await setIfChanged(host, STATISTICS_STATES.adjustAckDe, "Ungültiges JSON.");
		return;
	}
	const result = applyStatisticsAdjust(persist, submit, now);
	const dateKey = submit.date ?? localDateKey(now);
	if (submit.refresh) {
		await recalculateMonthMobilityDays(host, persist, now, cfg, dateKey);
	} else if (submit.mobility) {
		const day = persist.days[dateKey];
		if (day) {
			const evConsMapped = await readForeignNum(host, cfg.evConsumptionKwhPer100StateId);
			const evCons = resolveEvKwhPer100({
				mapped: evConsMapped,
				fallback: cfg.evConsumptionFallbackKwhPer100,
			});
			const fuelPrice = resolveSeedFuelPriceEurPerL({
				explicit: day.mobility.iceFuelPriceEurPerL,
				fallback: cfg.fuelPriceFallbackEurPerL,
			});
			finalizeMobilityDayTotals(day.mobility, {
				evKwhPer100: evCons.value,
				fuelPriceEurPerL: fuelPrice,
				iceLPer100Km: cfg.iceLPer100Km,
				evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
			});
		}
	}
	persistDirty = true;
	await flushPersist(host);
	await setIfChanged(host, STATISTICS_STATES.adjustAckDe, result.ackDe);
	host.log?.info?.(`statistics adjust: ${result.ackDe}`);
}

/**
 * Ein Statistik-Tick — nur Reporting. Keine Gerätewrites, kein Planner-Eingriff.
 */
export async function tickStatistics(host: StatisticsHost, now: Date = new Date()): Promise<void> {
	const cfg = statisticsConfigFromAdapter(host.config);
	const dateKey = localDateKey(now);
	const persist = await loadPersist(host);
	rolloverRuntimeIfNeeded(persist, dateKey);

	await handlePublicSubmit(host, persist, now);
	await handleAdjustSubmit(host, persist, now, cfg);

	if (!cfg.enabled) {
		await setIfChanged(host, STATISTICS_STATES.enabled, false);
		await setIfChanged(host, STATISTICS_STATES.reasonDe, "Statistik deaktiviert (Admin).");
		await flushPersist(host);
		return;
	}

	const reasonsHome: string[] = [];
	const reasonsMob: string[] = [];
	const day = ensureDay(persist, dateKey);
	const rt = persist.runtime;
	const nowMs = now.getTime();
	const dtSec =
		rt.lastTickMs !== null && nowMs > rt.lastTickMs
			? Math.min(600, (nowMs - rt.lastTickMs) / 1000)
			: 0;

	const [
		gridImportEnergy,
		gridExportEnergy,
		gridImportPowerW,
		dynamicCostMapped,
		rewardsCredit,
		fuelMapped,
		evConsMapped,
		sessionEnergy,
		sessionPricePerKwh,
		wbConnected,
		vehicleSoc,
		priceNowCt,
		capacityKwh,
		rewardsActive,
	] = await Promise.all([
		readForeignNum(host, cfg.gridImportEnergyKwhStateId),
		readForeignNum(host, cfg.gridExportEnergyKwhStateId),
		readForeignNum(host, cfg.gridImportPowerWStateId),
		readForeignNum(host, cfg.dynamicCostTodayEurStateId),
		readForeignNum(host, cfg.gridRewardsCreditEurStateId),
		readForeignNum(host, cfg.fuelPriceEurPerLStateId),
		readForeignNum(host, cfg.evConsumptionKwhPer100StateId),
		readForeignNum(host, cfg.wallboxSessionEnergyKwhStateId).then((raw) =>
			normalizeWallboxSessionEnergyKwh(cfg.wallboxSessionEnergyKwhStateId, raw),
		),
		readForeignNum(host, cfg.wallboxSessionPricePerKwhStateId),
		readForeignBool(host, cfg.wallboxConnectedStateId),
		readForeignNum(host, cfg.vehicleSocPctStateId),
		readForeignNum(host, "live.price.now_ct_per_kwh"),
		readForeignNum(host, "live.battery.capacity_kwh"),
		readForeignBool(host, cfg.tibberGridRewardsActiveStateId),
	]);
	void rewardsActive;
	void (await readForeignRaw(host, cfg.externalVehicleChargeStateId));

	// --- Haus: Import-Energie ---
	let importKwhToday = day.home.gridImportKwh ?? 0;
	let haveImport = day.home.gridImportKwh !== null;
	if (cfg.gridImportEnergyKwhStateId) {
		const d = energyCounterDeltaKwh(rt.gridImportEnergyBaselineKwh, gridImportEnergy);
		rt.gridImportEnergyBaselineKwh = d.newBaseline;
		if (d.deltaKwh !== null && d.deltaKwh > 0) {
			importKwhToday = Math.round((importKwhToday + d.deltaKwh) * 1000) / 1000;
			haveImport = true;
		} else if (d.newBaseline !== null && day.home.gridImportKwh === null) {
			haveImport = true;
			importKwhToday = 0;
		}
	} else {
		reasonsHome.push("Netzbezug-Zähler nicht gemappt.");
	}

	if (cfg.gridExportEnergyKwhStateId) {
		const d = energyCounterDeltaKwh(rt.gridExportEnergyBaselineKwh, gridExportEnergy);
		rt.gridExportEnergyBaselineKwh = d.newBaseline;
		if (d.deltaKwh !== null && d.deltaKwh > 0) {
			day.home.gridExportKwh =
				Math.round(((day.home.gridExportKwh ?? 0) + d.deltaKwh) * 1000) / 1000;
		}
	}

	// Tibber: Mapping accumulatedCost + anteilige Monatsgebühren aus Tarif-Tab
	// (Grundpreis + Netzentgelt). Verivox-Festtarif unverändert (alles im Statistik-Tab).
	const monthFrac = 1 / daysInMonth(dateKey);
	const tibberMonthlyFees =
		dailyBaseShareEur(cfg.tibberMonthlyBaseEur, monthFrac) +
		dailyBaseShareEur(cfg.tibberMonthlyGridFeeEur, monthFrac);
	let dynamicFromTibber = false;
	if (dynamicCostMapped !== null && dynamicCostMapped >= 0) {
		day.home.dynamicCostEur = tibberDayCostEur({
			accumulatedCostEur: dynamicCostMapped,
			monthlyBaseEur: cfg.tibberMonthlyBaseEur,
			monthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
			monthFraction: monthFrac,
		});
		dynamicFromTibber = true;
	} else if (dtSec > 0) {
		const integ = integrateImportCostEur({
			importPowerW: gridImportPowerW,
			priceCtPerKwh: priceNowCt,
			dtSec,
		});
		if (integ.costEur > 0 || rt.integratedDynamicCostEur > 0) {
			if (integ.costEur > 0) {
				rt.integratedDynamicCostEur += integ.costEur;
				rt.integratedGridImportKwhFromPower += integ.kwh;
			}
			day.home.dynamicCostEur =
				Math.round((rt.integratedDynamicCostEur + tibberMonthlyFees) * 100) / 100;
			if (!cfg.gridImportEnergyKwhStateId && rt.integratedGridImportKwhFromPower > 0) {
				importKwhToday = Math.round(rt.integratedGridImportKwhFromPower * 1000) / 1000;
				haveImport = true;
			}
		} else if (!cfg.gridImportPowerWStateId && !cfg.dynamicCostTodayEurStateId) {
			reasonsHome.push("Keine Tibber-Tageskosten (Mapping accumulatedCost) und kein Netzleistung×Preis.");
		}
	}
	if (!dynamicFromTibber && day.home.dynamicCostEur === null && cfg.dynamicCostTodayEurStateId) {
		reasonsHome.push("Tibber-Tageskosten-Mapping gesetzt, aber noch kein Wert.");
	}

	if (haveImport) {
		day.home.gridImportKwh = importKwhToday;
	}

	day.home.fixedTariffCostEur = fixedTariffCostEur({
		gridImportKwh: day.home.gridImportKwh,
		compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
		monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
		monthFraction: monthFrac,
	});
	if (cfg.compareTariffCtPerKwh === null) {
		reasonsHome.push("Vergleichstarif (ct/kWh) im Admin fehlt.");
	}

	day.home.gridRewardsCreditEur =
		rewardsCredit !== null && rewardsCredit >= 0 ? rewardsCredit : day.home.gridRewardsCreditEur;

	if (
		day.home.gridExportKwh !== null &&
		cfg.feedInCtPerKwh !== null &&
		cfg.feedInCtPerKwh >= 0
	) {
		day.home.feedInCreditEur =
			Math.round(((day.home.gridExportKwh * cfg.feedInCtPerKwh) / 100) * 100) / 100;
	}

	day.home.savingsVsFixedEur = savingsVsFixedEur(
		day.home.fixedTariffCostEur,
		day.home.dynamicCostEur,
		day.home.gridRewardsCreditEur,
	);

	// --- Mobilität: Heimladung ---
	if (wbConnected === true && sessionEnergy !== null) {
		const d = energyCounterDeltaKwh(rt.wallboxSessionEnergyBaselineKwh, sessionEnergy);
		rt.wallboxSessionEnergyBaselineKwh = d.newBaseline;
		if (d.deltaKwh !== null && d.deltaKwh > 0) {
			const price =
				sessionPricePerKwh !== null && sessionPricePerKwh >= 0
					? sessionPricePerKwh
					: priceNowCt !== null
						? priceNowCt / 100
						: null;
			// Heuristik: session_price_per_kwh ~0 → PV; sonst Netz (Tibber/€)
			const looksPv = price !== null && price <= 0.02;
			if (looksPv) {
				rt.homePvKwh += d.deltaKwh;
				rt.homePvCostEur += price !== null ? d.deltaKwh * price : 0;
			} else {
				rt.homeGridKwh += d.deltaKwh;
				rt.homeGridCostEur +=
					price !== null ? d.deltaKwh * price : (d.deltaKwh * (priceNowCt ?? 0)) / 100;
			}
		}
	} else if (wbConnected === false) {
		rt.wallboxSessionEnergyBaselineKwh = sessionEnergy;
	}

	// Schnellader: SOC steigt, Wallbox nicht connected
	if (
		wbConnected === false &&
		rt.lastWallboxConnected === false &&
		vehicleSoc !== null &&
		rt.lastVehicleSocPct !== null
	) {
		const est = estimateKwhFromSocRise({
			socBeforePct: rt.lastVehicleSocPct,
			socAfterPct: vehicleSoc,
			capacityKwh,
			minRisePct: 2,
		});
		if (est !== null && est >= 0.5) {
			const fuel = resolveFuelPriceEurPerL({
				mapped: fuelMapped,
				fallback: cfg.fuelPriceFallbackEurPerL,
			});
			day.publicSessions.push(
				openPublicChargeSession({
					nowIso: now.toISOString(),
					estimatedKwh: est,
					fuelPriceEurPerLSnapshot: fuel,
				}),
			);
			host.log?.info?.(
				`statistics: Schnellader-Session geöffnet (~${est} kWh, SOC ${rt.lastVehicleSocPct}→${vehicleSoc})`,
			);
		}
	}
	rt.lastVehicleSocPct = vehicleSoc;
	rt.lastWallboxConnected = wbConnected;
	rt.lastTickMs = nowMs;

	const evCons = resolveEvKwhPer100({
		mapped: evConsMapped,
		fallback: cfg.evConsumptionFallbackKwhPer100,
	});
	const fuelPrice = resolveFuelPriceEurPerL({
		mapped: fuelMapped,
		fallback: cfg.fuelPriceFallbackEurPerL,
	});
	if (evCons.source === "missing") {
		reasonsMob.push("E-Auto-Verbrauch nicht gemappt (Ford/HA) und kein Admin-Fallback.");
	}
	if (fuelPrice === null) {
		reasonsMob.push("Spritpreis fehlt (Tankerkönig-Mapping oder Fallback).");
	}
	if (cfg.iceLPer100Km === null) {
		reasonsMob.push("Verbrenner l/100 km im Admin fehlt.");
	}

	const invoiced = invoicedPublicTotals(day.publicSessions);
	const pendingKwh = pendingPublicKwh(day.publicSessions);
	const homeChargeKwh = rt.homePvKwh + rt.homeGridKwh;
	const km = estimateKmFromEvKwh(
		homeChargeKwh + invoiced.kwh > 0 ? homeChargeKwh + invoiced.kwh : null,
		evCons.value,
	);
	const ice = iceCostForKm({
		km,
		lPer100Km: cfg.iceLPer100Km,
		fuelPriceEurPerL: fuelPrice,
	});
	const rewardsMob =
		day.home.gridRewardsCreditEur !== null ? day.home.gridRewardsCreditEur : null;
	const evCostRaw =
		rt.homePvCostEur +
		rt.homeGridCostEur +
		invoiced.eur -
		(rewardsMob ?? 0);
	const evCost =
		homeChargeKwh > 0 || invoiced.kwh > 0 || rewardsMob !== null
			? Math.round(Math.max(0, evCostRaw) * 100) / 100
			: null;

	day.mobility = {
		dateKey,
		homePvKwh: rt.homePvKwh > 0 ? Math.round(rt.homePvKwh * 1000) / 1000 : null,
		homeGridKwh: rt.homeGridKwh > 0 ? Math.round(rt.homeGridKwh * 1000) / 1000 : null,
		homePvCostEur: rt.homePvKwh > 0 ? Math.round(rt.homePvCostEur * 100) / 100 : null,
		homeGridCostEur: rt.homeGridKwh > 0 ? Math.round(rt.homeGridCostEur * 100) / 100 : null,
		gridRewardsCreditEur: rewardsMob,
		publicInvoicedKwh: invoiced.kwh > 0 ? invoiced.kwh : null,
		publicInvoicedEur: invoiced.eur > 0 ? invoiced.eur : null,
		publicPendingKwh: pendingKwh > 0 ? Math.round(pendingKwh * 1000) / 1000 : null,
		evTotalCostEur: evCost,
		evKwhPer100Km: evCons.value,
		evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
		estimatedKm: km,
		iceLiters: ice.liters,
		iceFuelPriceEurPerL: fuelPrice,
		iceCostEur: ice.costEur,
		savingsVsIceEur:
			evCost !== null && ice.costEur !== null
				? Math.round((ice.costEur - evCost) * 100) / 100
				: null,
	};

	persistDirty = true;

	const monthDayKeys = monthKeys(dateKey, persist.days);
	const monthHomes = monthDayKeys.map((k) => persist.days[k]!.home);
	const monthMobs = monthDayKeys.map((k) => persist.days[k]!.mobility);
	const homeMonth = sumHomeDays(monthHomes);
	const mobMonth = sumMobilityDays(monthMobs, {
		evKwhPer100: evCons.value,
		fuelPriceEurPerL: fuelPrice,
		iceLPer100Km: cfg.iceLPer100Km,
		evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
	});
	const openSessions = day.publicSessions.filter((s) => s.status === "pending_invoice").length;

	const homeTodaySum = buildHomeSummary("today", day.home, reasonsHome);
	const homeMonthSum = buildHomeSummary("month", homeMonth, reasonsHome);
	const mobTodaySum = buildMobilitySummary("today", day.mobility, openSessions, reasonsMob);
	const mobMonthSum = buildMobilitySummary(
		"month",
		mobMonth,
		openSessions,
		reasonsMob,
	);

	const safeCfg: Partial<StatisticsAdminConfig> = {
		enabled: cfg.enabled,
		compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
		compareTariffMonthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
		tibberMonthlyBaseEur: cfg.tibberMonthlyBaseEur,
		tibberMonthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
		iceFuelType: cfg.iceFuelType,
		iceLPer100Km: cfg.iceLPer100Km,
	};

	await setIfChanged(host, STATISTICS_STATES.enabled, true);
	await setIfChanged(host, STATISTICS_STATES.lastRunAt, now.toISOString());
	await setIfChanged(host, STATISTICS_STATES.configJson, JSON.stringify(safeCfg));
	await setIfChanged(host, STATISTICS_STATES.homeTodayJson, JSON.stringify(homeTodaySum));
	await setIfChanged(host, STATISTICS_STATES.homeMonthJson, JSON.stringify(homeMonthSum));
	await setIfChanged(host, STATISTICS_STATES.mobilityTodayJson, JSON.stringify(mobTodaySum));
	await setIfChanged(host, STATISTICS_STATES.mobilityMonthJson, JSON.stringify(mobMonthSum));
	await setIfChanged(host, STATISTICS_STATES.homeTodaySavingsEur, day.home.savingsVsFixedEur);
	await setIfChanged(host, STATISTICS_STATES.homeMonthSavingsEur, homeMonth.savingsVsFixedEur);
	await setIfChanged(host, STATISTICS_STATES.mobilityTodaySavingsEur, day.mobility.savingsVsIceEur);
	await setIfChanged(host, STATISTICS_STATES.mobilityMonthSavingsEur, mobMonth.savingsVsIceEur);
	await setIfChanged(
		host,
		STATISTICS_STATES.publicPendingJson,
		JSON.stringify(day.publicSessions.filter((s) => s.status === "pending_invoice")),
	);

	const reason =
		[
			homeTodaySum.savingsVsFixedEur !== null
				? `Haus heute Tibber vs. Festtarif: ${homeTodaySum.savingsVsFixedEur.toFixed(2)} €.`
				: reasonsHome[0] ?? "Haus: Daten unvollständig.",
			homeMonthSum.savingsVsFixedEur !== null
				? `Haus Monat: ${homeMonthSum.savingsVsFixedEur.toFixed(2)} €.`
				: "",
			mobTodaySum.savingsVsIceEur !== null
				? `Mobilität heute vs. Verbrenner: ${mobTodaySum.savingsVsIceEur.toFixed(2)} €.`
				: reasonsMob[0] ?? "Mobilität: Daten unvollständig.",
			mobMonthSum.savingsVsIceEur !== null
				? `Mobilität Monat: ${mobMonthSum.savingsVsIceEur.toFixed(2)} €.`
				: "",
			openSessions > 0 ? `${openSessions} Schnellader-Session(s) ohne Rechnung.` : "",
		]
			.filter(Boolean)
			.join(" ");
	await setIfChanged(host, STATISTICS_STATES.reasonDe, reason);

	await flushPersist(host);
}

export function __resetStatisticsForTest(): void {
	persistCache = null;
	persistDirty = false;
}

export function isStatisticsRelatedState(relativeId: string): boolean {
	return (
		relativeId === STATISTICS_STATES.publicSubmitRequest ||
		relativeId === STATISTICS_STATES.adjustRequest ||
		relativeId.startsWith("statistics.")
	);
}

export async function handleStatisticsStateChange(
	host: StatisticsHost,
	relativeId: string,
	val: unknown,
	ack: boolean,
): Promise<boolean> {
	if (
		(relativeId !== STATISTICS_STATES.publicSubmitRequest &&
			relativeId !== STATISTICS_STATES.adjustRequest) ||
		ack
	) {
		return relativeId.startsWith("statistics.");
	}
	void val;
	await tickStatistics(host);
	return true;
}

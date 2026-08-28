"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStatisticsStateChange = exports.isStatisticsRelatedState = exports.__resetStatisticsForTest = exports.tickStatistics = void 0;
const state_util_1 = require("../ems_light/state_util");
const config_1 = require("./config");
const compute_1 = require("./compute");
const grid_rewards_1 = require("./grid_rewards");
const period_1 = require("./period");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const public_charge_1 = require("./public_charge");
const adjust_1 = require("./adjust");
async function setIfChanged(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
let persistCache = null;
let persistDirty = false;
function baseDir(host) {
    return typeof host.getAbsolutePath === "function"
        ? host.getAbsolutePath(persist_1.STATISTICS_PERSIST_CATEGORY)
        : null;
}
async function loadPersist(host) {
    if (persistCache)
        return persistCache;
    const dir = baseDir(host);
    if (!dir) {
        persistCache = (0, persist_1.emptyPersist)();
        return persistCache;
    }
    persistCache = await (0, persist_1.readStatisticsPersist)(dir);
    return persistCache;
}
async function flushPersist(host) {
    if (!persistDirty || !persistCache)
        return;
    const dir = baseDir(host);
    if (!dir)
        return;
    await (0, persist_1.writeStatisticsPersist)(dir, persistCache);
    persistDirty = false;
}
async function readForeignNum(host, id) {
    if (!id)
        return null;
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        return (0, state_util_1.asNum)((await reader(id))?.val);
    }
    catch {
        return null;
    }
}
async function readForeignBool(host, id) {
    if (!id)
        return null;
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        return (0, state_util_1.asBool)((await reader(id))?.val);
    }
    catch {
        return null;
    }
}
async function readForeignRaw(host, id) {
    if (!id)
        return null;
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        return (await reader(id))?.val ?? null;
    }
    catch {
        return null;
    }
}
function monthKeys(dateKey, days) {
    const prefix = dateKey.slice(0, 7);
    return Object.keys(days)
        .filter((k) => k.startsWith(prefix))
        .sort();
}
function buildHomeSummary(period, home, reasonParts, meta) {
    return {
        period,
        periodLabelDe: meta?.periodLabelDe,
        fromKey: meta?.fromKey,
        toKey: meta?.toKey,
        gridImportKwh: home.gridImportKwh,
        dynamicCostEur: home.dynamicCostEur,
        fixedTariffCostEur: home.fixedTariffCostEur,
        savingsVsFixedEur: home.savingsVsFixedEur,
        gridRewardsCreditEur: home.gridRewardsSource === "off" ? null : home.gridRewardsCreditEur,
        gridRewardsSource: home.gridRewardsSource,
        reasonDe: reasonParts.join(" ") || "—",
    };
}
function buildMobilitySummary(period, mob, openSessions, reasonParts, meta) {
    return {
        period,
        periodLabelDe: meta?.periodLabelDe,
        fromKey: meta?.fromKey,
        toKey: meta?.toKey,
        homePvKwh: mob.homePvKwh,
        homeGridKwh: mob.homeGridKwh,
        homeGridCostEur: mob.homeGridCostEur,
        homeGridCostNetEur: mob.homeGridCostNetEur,
        gridRewardsSource: mob.gridRewardsSource,
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
function ensureDay(persist, dateKey) {
    if (!persist.days[dateKey]) {
        persist.days[dateKey] = (0, persist_1.emptyDayRecord)(dateKey);
        persistDirty = true;
    }
    return persist.days[dateKey];
}
function rolloverRuntimeIfNeeded(persist, dateKey) {
    if (persist.runtime.dateKey === dateKey)
        return;
    persist.runtime = (0, persist_1.emptyRuntime)(dateKey);
    persistDirty = true;
}
async function handlePublicSubmit(host, persist, now) {
    const st = await host.getStateAsync(ensure_states_1.STATISTICS_STATES.publicSubmitRequest);
    if (!st || st.ack === true)
        return;
    const submit = (0, public_charge_1.parsePublicInvoiceSubmit)(st.val);
    await host.setStateAsync(ensure_states_1.STATISTICS_STATES.publicSubmitRequest, { val: "", ack: true });
    if (!submit) {
        await setIfChanged(host, ensure_states_1.STATISTICS_STATES.publicSubmitAckDe, "Ungültiges JSON.");
        return;
    }
    const dateKey = (0, compute_1.localDateKey)(now);
    const day = ensureDay(persist, dateKey);
    const result = (0, public_charge_1.applyPublicInvoice)(day.publicSessions, submit, now.toISOString());
    day.publicSessions = result.sessions;
    persistDirty = true;
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.publicSubmitAckDe, result.ackDe);
    host.log?.info?.(`statistics public charge: ${result.ackDe}`);
}
async function recalculateMonthMobilityDays(host, persist, now, cfg, refDateKey) {
    const refKey = refDateKey ?? (0, compute_1.localDateKey)(now);
    const evConsMapped = await readForeignNum(host, cfg.evConsumptionKwhPer100StateId);
    const evCons = (0, compute_1.resolveEvKwhPer100)({
        mapped: evConsMapped,
        fallback: cfg.evConsumptionFallbackKwhPer100,
    });
    for (const key of monthKeys(refKey, persist.days)) {
        const day = persist.days[key];
        if (!day)
            continue;
        const mob = day.mobility;
        const chargeKwh = (mob.homePvKwh ?? 0) + (mob.homeGridKwh ?? 0) + (mob.publicInvoicedKwh ?? 0);
        if (chargeKwh <= 0 && !(mob.publicInvoicedEur ?? 0))
            continue;
        const fuelPrice = (0, compute_1.resolveSeedFuelPriceEurPerL)({
            explicit: mob.iceFuelPriceEurPerL,
            fallback: cfg.fuelPriceFallbackEurPerL,
        });
        (0, compute_1.finalizeMobilityDayTotals)(mob, {
            evKwhPer100: evCons.value,
            fuelPriceEurPerL: fuelPrice,
            iceLPer100Km: cfg.iceLPer100Km,
            evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
        });
    }
}
async function handleAdjustSubmit(host, persist, now, cfg) {
    const st = await host.getStateAsync(ensure_states_1.STATISTICS_STATES.adjustRequest);
    if (!st || st.ack === true)
        return;
    const submit = (0, adjust_1.parseStatisticsAdjustSubmit)(st.val);
    await host.setStateAsync(ensure_states_1.STATISTICS_STATES.adjustRequest, { val: "", ack: true });
    if (!submit) {
        await setIfChanged(host, ensure_states_1.STATISTICS_STATES.adjustAckDe, "Ungültiges JSON.");
        return;
    }
    const result = (0, adjust_1.applyStatisticsAdjust)(persist, submit, now);
    const dateKey = submit.date ?? (0, compute_1.localDateKey)(now);
    if (submit.refresh) {
        await recalculateMonthMobilityDays(host, persist, now, cfg, dateKey);
    }
    else if (submit.mobility) {
        const day = persist.days[dateKey];
        if (day) {
            const evConsMapped = await readForeignNum(host, cfg.evConsumptionKwhPer100StateId);
            const evCons = (0, compute_1.resolveEvKwhPer100)({
                mapped: evConsMapped,
                fallback: cfg.evConsumptionFallbackKwhPer100,
            });
            const fuelPrice = (0, compute_1.resolveSeedFuelPriceEurPerL)({
                explicit: day.mobility.iceFuelPriceEurPerL,
                fallback: cfg.fuelPriceFallbackEurPerL,
            });
            (0, compute_1.finalizeMobilityDayTotals)(day.mobility, {
                evKwhPer100: evCons.value,
                fuelPriceEurPerL: fuelPrice,
                iceLPer100Km: cfg.iceLPer100Km,
                evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
            });
        }
    }
    persistDirty = true;
    await flushPersist(host);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.adjustAckDe, result.ackDe);
    host.log?.info?.(`statistics adjust: ${result.ackDe}`);
}
/**
 * Ein Statistik-Tick — nur Reporting. Keine Gerätewrites, kein Planner-Eingriff.
 */
async function tickStatistics(host, now = new Date()) {
    const cfg = (0, config_1.statisticsConfigFromAdapter)(host.config);
    const dateKey = (0, compute_1.localDateKey)(now);
    const persist = await loadPersist(host);
    rolloverRuntimeIfNeeded(persist, dateKey);
    await handlePublicSubmit(host, persist, now);
    await handleAdjustSubmit(host, persist, now, cfg);
    if (!cfg.enabled) {
        await setIfChanged(host, ensure_states_1.STATISTICS_STATES.enabled, false);
        await setIfChanged(host, ensure_states_1.STATISTICS_STATES.reasonDe, "Statistik deaktiviert (Admin).");
        await flushPersist(host);
        return;
    }
    const reasonsHome = [];
    const reasonsMob = [];
    const day = ensureDay(persist, dateKey);
    const rt = persist.runtime;
    const nowMs = now.getTime();
    const dtSec = rt.lastTickMs !== null && nowMs > rt.lastTickMs
        ? Math.min(600, (nowMs - rt.lastTickMs) / 1000)
        : 0;
    const [gridImportEnergy, gridExportEnergy, gridImportPowerW, dynamicCostMapped, rewardsCreditDay, rewardsCreditMonth, fuelMapped, evConsMapped, sessionEnergy, sessionPricePerKwh, wbConnected, vehicleSoc, priceNowCt, capacityKwh, rewardsActive,] = await Promise.all([
        readForeignNum(host, cfg.gridImportEnergyKwhStateId),
        readForeignNum(host, cfg.gridExportEnergyKwhStateId),
        readForeignNum(host, cfg.gridImportPowerWStateId),
        readForeignNum(host, cfg.dynamicCostTodayEurStateId),
        readForeignNum(host, cfg.gridRewardsCreditDayStateId),
        readForeignNum(host, cfg.gridRewardsCreditMonthStateId),
        readForeignNum(host, cfg.fuelPriceEurPerLStateId),
        readForeignNum(host, cfg.evConsumptionKwhPer100StateId),
        readForeignNum(host, cfg.wallboxSessionEnergyKwhStateId).then((raw) => (0, compute_1.normalizeWallboxSessionEnergyKwh)(cfg.wallboxSessionEnergyKwhStateId, raw)),
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
        const d = (0, compute_1.energyCounterDeltaKwh)(rt.gridImportEnergyBaselineKwh, gridImportEnergy);
        rt.gridImportEnergyBaselineKwh = d.newBaseline;
        if (d.deltaKwh !== null && d.deltaKwh > 0) {
            importKwhToday = Math.round((importKwhToday + d.deltaKwh) * 1000) / 1000;
            haveImport = true;
        }
        else if (d.newBaseline !== null && day.home.gridImportKwh === null) {
            haveImport = true;
            importKwhToday = 0;
        }
    }
    else {
        reasonsHome.push("Netzbezug-Zähler nicht gemappt.");
    }
    if (cfg.gridExportEnergyKwhStateId) {
        const d = (0, compute_1.energyCounterDeltaKwh)(rt.gridExportEnergyBaselineKwh, gridExportEnergy);
        rt.gridExportEnergyBaselineKwh = d.newBaseline;
        if (d.deltaKwh !== null && d.deltaKwh > 0) {
            day.home.gridExportKwh =
                Math.round(((day.home.gridExportKwh ?? 0) + d.deltaKwh) * 1000) / 1000;
        }
    }
    // Tibber: Mapping accumulatedCost + anteilige Monatsgebühren aus Tarif-Tab
    // (Grundpreis + Netzentgelt). Verivox-Festtarif unverändert (alles im Statistik-Tab).
    const monthFrac = 1 / (0, compute_1.daysInMonth)(dateKey);
    const tibberMonthlyFees = (0, compute_1.dailyBaseShareEur)(cfg.tibberMonthlyBaseEur, monthFrac) +
        (0, compute_1.dailyBaseShareEur)(cfg.tibberMonthlyGridFeeEur, monthFrac);
    let dynamicFromTibber = false;
    if (dynamicCostMapped !== null && dynamicCostMapped >= 0) {
        day.home.dynamicCostEur = (0, compute_1.tibberDayCostEur)({
            accumulatedCostEur: dynamicCostMapped,
            monthlyBaseEur: cfg.tibberMonthlyBaseEur,
            monthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
            monthFraction: monthFrac,
        });
        dynamicFromTibber = true;
    }
    else if (dtSec > 0) {
        const integ = (0, compute_1.integrateImportCostEur)({
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
        }
        else if (!cfg.gridImportPowerWStateId && !cfg.dynamicCostTodayEurStateId) {
            reasonsHome.push("Keine Tibber-Tageskosten (Mapping accumulatedCost) und kein Netzleistung×Preis.");
        }
    }
    if (!dynamicFromTibber && day.home.dynamicCostEur === null && cfg.dynamicCostTodayEurStateId) {
        reasonsHome.push("Tibber-Tageskosten-Mapping gesetzt, aber noch kein Wert.");
    }
    if (haveImport) {
        day.home.gridImportKwh = importKwhToday;
    }
    day.home.fixedTariffCostEur = (0, compute_1.fixedTariffCostEur)({
        gridImportKwh: day.home.gridImportKwh,
        compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
        monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
        monthFraction: monthFrac,
    });
    if (cfg.compareTariffCtPerKwh === null) {
        reasonsHome.push("Vergleichstarif (ct/kWh) im Admin fehlt.");
    }
    const todayRewards = (0, grid_rewards_1.resolveTodayGridRewards)({
        enabled: cfg.gridRewardsEnabled,
        mappedDayEur: rewardsCreditDay,
    });
    day.home = (0, compute_1.applyHomeGridRewards)(day.home, todayRewards);
    if (day.home.gridExportKwh !== null &&
        cfg.feedInCtPerKwh !== null &&
        cfg.feedInCtPerKwh >= 0) {
        day.home.feedInCreditEur =
            Math.round(((day.home.gridExportKwh * cfg.feedInCtPerKwh) / 100) * 100) / 100;
    }
    persistDirty = true;
    // --- Mobilität: Heimladung ---
    if (wbConnected === true && sessionEnergy !== null) {
        const d = (0, compute_1.energyCounterDeltaKwh)(rt.wallboxSessionEnergyBaselineKwh, sessionEnergy);
        rt.wallboxSessionEnergyBaselineKwh = d.newBaseline;
        if (d.deltaKwh !== null && d.deltaKwh > 0) {
            const price = sessionPricePerKwh !== null && sessionPricePerKwh >= 0
                ? sessionPricePerKwh
                : priceNowCt !== null
                    ? priceNowCt / 100
                    : null;
            // Heuristik: session_price_per_kwh ~0 → PV; sonst Netz (Tibber/€)
            const looksPv = price !== null && price <= 0.02;
            if (looksPv) {
                rt.homePvKwh += d.deltaKwh;
                rt.homePvCostEur += price !== null ? d.deltaKwh * price : 0;
            }
            else {
                rt.homeGridKwh += d.deltaKwh;
                rt.homeGridCostEur +=
                    price !== null ? d.deltaKwh * price : (d.deltaKwh * (priceNowCt ?? 0)) / 100;
            }
        }
    }
    else if (wbConnected === false) {
        rt.wallboxSessionEnergyBaselineKwh = sessionEnergy;
    }
    // Schnellader: SOC steigt, Wallbox nicht connected
    if (wbConnected === false &&
        rt.lastWallboxConnected === false &&
        vehicleSoc !== null &&
        rt.lastVehicleSocPct !== null) {
        const est = (0, compute_1.estimateKwhFromSocRise)({
            socBeforePct: rt.lastVehicleSocPct,
            socAfterPct: vehicleSoc,
            capacityKwh,
            minRisePct: 2,
        });
        if (est !== null && est >= 0.5) {
            const fuel = (0, compute_1.resolveFuelPriceEurPerL)({
                mapped: fuelMapped,
                fallback: cfg.fuelPriceFallbackEurPerL,
            });
            day.publicSessions.push((0, public_charge_1.openPublicChargeSession)({
                nowIso: now.toISOString(),
                estimatedKwh: est,
                fuelPriceEurPerLSnapshot: fuel,
            }));
            host.log?.info?.(`statistics: Schnellader-Session geöffnet (~${est} kWh, SOC ${rt.lastVehicleSocPct}→${vehicleSoc})`);
        }
    }
    rt.lastVehicleSocPct = vehicleSoc;
    rt.lastWallboxConnected = wbConnected;
    rt.lastTickMs = nowMs;
    const evCons = (0, compute_1.resolveEvKwhPer100)({
        mapped: evConsMapped,
        fallback: cfg.evConsumptionFallbackKwhPer100,
    });
    const fuelPrice = (0, compute_1.resolveFuelPriceEurPerL)({
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
    const invoiced = (0, public_charge_1.invoicedPublicTotals)(day.publicSessions);
    const pendingKwh = (0, public_charge_1.pendingPublicKwh)(day.publicSessions);
    const homeChargeKwh = rt.homePvKwh + rt.homeGridKwh;
    const km = (0, compute_1.estimateKmFromEvKwh)(homeChargeKwh + invoiced.kwh > 0 ? homeChargeKwh + invoiced.kwh : null, evCons.value);
    const ice = (0, compute_1.iceCostForKm)({
        km,
        lPer100Km: cfg.iceLPer100Km,
        fuelPriceEurPerL: fuelPrice,
    });
    const rewardsMob = todayRewards;
    const evCostRaw = rt.homePvCostEur +
        rt.homeGridCostEur +
        invoiced.eur -
        (rewardsMob.source !== "off" && rewardsMob.creditEur !== null ? rewardsMob.creditEur : 0);
    const evCost = homeChargeKwh > 0 || invoiced.kwh > 0 || rewardsMob.creditEur !== null
        ? Math.round(Math.max(0, evCostRaw) * 100) / 100
        : null;
    day.mobility = (0, compute_1.applyMobilityGridRewards)({
        dateKey,
        homePvKwh: rt.homePvKwh > 0 ? Math.round(rt.homePvKwh * 1000) / 1000 : null,
        homeGridKwh: rt.homeGridKwh > 0 ? Math.round(rt.homeGridKwh * 1000) / 1000 : null,
        homePvCostEur: rt.homePvKwh > 0 ? Math.round(rt.homePvCostEur * 100) / 100 : null,
        homeGridCostEur: rt.homeGridKwh > 0 ? Math.round(rt.homeGridCostEur * 100) / 100 : null,
        homeGridCostNetEur: null,
        gridRewardsCreditEur: null,
        gridRewardsSource: "off",
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
        savingsVsIceEur: evCost !== null && ice.costEur !== null
            ? Math.round((ice.costEur - evCost) * 100) / 100
            : null,
    }, rewardsMob);
    persistDirty = true;
    const monthPrefixKey = dateKey.slice(0, 7);
    const monthBilling = persist.monthRewardsBilling?.[monthPrefixKey]?.creditEur ?? null;
    const monthRewards = (0, grid_rewards_1.resolveMonthGridRewards)({
        enabled: cfg.gridRewardsEnabled,
        monthPrefix: monthPrefixKey,
        billingCreditEur: monthBilling,
        mappedMonthEur: rewardsCreditMonth,
    });
    const monthDayKeys = monthKeys(dateKey, persist.days);
    const monthHomes = monthDayKeys.map((k) => persist.days[k].home);
    const monthMobs = monthDayKeys.map((k) => persist.days[k].mobility);
    const homeMonthPersist = (0, compute_1.sumHomeDays)(monthHomes);
    const jsonDailyId = cfg.tibberJsonDailyStateId;
    const jsonMonthlyId = (0, compute_1.siblingTibberConsumptionState)(jsonDailyId, "jsonMonthly");
    const currentMonthKwhId = cfg.gridImportMonthKwhStateId ||
        (0, compute_1.siblingTibberConsumptionState)(jsonDailyId, "currentMonthConsumption");
    const tibberMonth = (0, compute_1.resolveHomeMonthFromTibber)({
        dateKey,
        jsonDailyRaw: jsonDailyId ? await readForeignRaw(host, jsonDailyId) : null,
        jsonMonthlyRaw: jsonMonthlyId ? await readForeignRaw(host, jsonMonthlyId) : null,
        currentMonthKwh: currentMonthKwhId ? await readForeignNum(host, currentMonthKwhId) : null,
        mappedMonthKwh: null,
        mappedMonthDynamicEur: cfg.dynamicCostMonthEurStateId
            ? await readForeignNum(host, cfg.dynamicCostMonthEurStateId)
            : null,
    });
    let homeMonth = homeMonthPersist;
    if (tibberMonth.gridImportKwh !== null || tibberMonth.dynamicCostEur !== null) {
        homeMonth = (0, compute_1.buildHomeMonthTotals)({
            dateKey,
            gridImportKwh: tibberMonth.gridImportKwh ?? homeMonthPersist.gridImportKwh,
            dynamicCostEur: tibberMonth.dynamicCostEur ?? homeMonthPersist.dynamicCostEur,
            gridRewardsCreditEur: monthRewards.source === "off" ? null : monthRewards.creditEur,
            gridRewardsSource: monthRewards.source,
            gridExportKwh: homeMonthPersist.gridExportKwh,
            feedInCtPerKwh: cfg.feedInCtPerKwh,
            compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
            compareTariffMonthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
            tibberMonthlyBaseEur: cfg.tibberMonthlyBaseEur,
            tibberMonthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
            addTibberFeesToDynamic: tibberMonth.addTibberFeesToDynamic,
        });
    }
    else {
        homeMonth = (0, compute_1.applyHomeGridRewards)(homeMonthPersist, monthRewards);
        if (jsonDailyId) {
            reasonsHome.push("Haus Monat: Tibber jsonDaily leer — Tibberlink: Historische Verbrauchsdaten + Tage≥31 aktivieren.");
        }
    }
    const mobMonth = (0, compute_1.sumMobilityDays)(monthMobs, {
        evKwhPer100: evCons.value,
        fuelPriceEurPerL: fuelPrice,
        iceLPer100Km: cfg.iceLPer100Km,
        evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
    }, monthRewards);
    const openSessions = day.publicSessions.filter((s) => s.status === "pending_invoice").length;
    const periodIdRaw = await host.getStateAsync(ensure_states_1.STATISTICS_STATES.periodId);
    const periodId = (0, period_1.normalizePeriodId)(periodIdRaw?.val, "this_month");
    if (periodIdRaw?.val !== periodId) {
        await host.setStateAsync(ensure_states_1.STATISTICS_STATES.periodId, { val: periodId, ack: true });
    }
    const periodRange = (0, period_1.resolvePeriodRange)(periodId, dateKey);
    const periodOptions = (0, period_1.listPeriodOptions)(dateKey, Object.keys(persist.days));
    const reasonsPeriod = [];
    let homePeriod = homeMonth;
    let mobPeriod = mobMonth;
    let periodMeta = {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    };
    if (periodRange) {
        periodMeta = {
            periodLabelDe: periodRange.labelDe,
            fromKey: periodRange.fromKey,
            toKey: periodRange.toKey,
        };
        if (periodId === "this_month") {
            homePeriod = homeMonth;
            mobPeriod = mobMonth;
        }
        else {
            const keys = (0, period_1.dayKeysInRange)(persist.days, periodRange.fromKey, periodRange.toKey);
            const periodHomes = keys.map((k) => persist.days[k].home);
            const periodMobs = keys.map((k) => persist.days[k].mobility);
            const periodRewards = (0, grid_rewards_1.resolvePeriodGridRewards)({
                enabled: cfg.gridRewardsEnabled,
                fromKey: periodRange.fromKey,
                toKey: periodRange.toKey,
                todayKey: dateKey,
                mappedMonthEur: rewardsCreditMonth,
                monthRewardsBilling: persist.monthRewardsBilling ?? {},
                dayCredits: keys.map((k) => ({
                    dateKey: k,
                    creditEur: persist.days[k].home.gridRewardsCreditEur,
                })),
            });
            let homeAgg = (0, compute_1.sumHomeDays)(periodHomes);
            const tibberRange = jsonDailyId
                ? (0, compute_1.sumTibberJsonDailyForRange)(await readForeignRaw(host, jsonDailyId), periodRange.fromKey, periodRange.toKey)
                : { gridImportKwh: null, dynamicCostEur: null };
            if (tibberRange.gridImportKwh !== null || tibberRange.dynamicCostEur !== null) {
                const importKwh = tibberRange.gridImportKwh ?? homeAgg.gridImportKwh;
                const dynamic = tibberRange.dynamicCostEur ?? homeAgg.dynamicCostEur;
                const fixed = (0, period_1.fixedTariffCostForRange)({
                    gridImportKwh: importKwh,
                    compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
                    monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
                    fromKey: periodRange.fromKey,
                    toKey: periodRange.toKey,
                });
                homeAgg = (0, compute_1.applyHomeGridRewards)({
                    ...homeAgg,
                    gridImportKwh: importKwh,
                    dynamicCostEur: dynamic,
                    fixedTariffCostEur: fixed,
                    savingsVsFixedEur: (0, compute_1.savingsVsFixedEur)(fixed, dynamic, periodRewards.source === "off" ? null : periodRewards.creditEur),
                }, periodRewards);
            }
            else {
                if (!keys.length) {
                    reasonsPeriod.push(`Zeitraum ${periodRange.labelDe}: keine Persistenz-Tage und kein Tibber jsonDaily in ${periodRange.fromKey}…${periodRange.toKey}.`);
                }
                const fixed = (0, period_1.fixedTariffCostForRange)({
                    gridImportKwh: homeAgg.gridImportKwh,
                    compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
                    monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
                    fromKey: periodRange.fromKey,
                    toKey: periodRange.toKey,
                }) ?? homeAgg.fixedTariffCostEur;
                homeAgg = (0, compute_1.applyHomeGridRewards)({
                    ...homeAgg,
                    fixedTariffCostEur: fixed,
                    savingsVsFixedEur: (0, compute_1.savingsVsFixedEur)(fixed, homeAgg.dynamicCostEur, periodRewards.source === "off" ? null : periodRewards.creditEur),
                }, periodRewards);
            }
            homePeriod = homeAgg;
            mobPeriod = (0, compute_1.sumMobilityDays)(periodMobs, {
                evKwhPer100: evCons.value,
                fuelPriceEurPerL: fuelPrice,
                iceLPer100Km: cfg.iceLPer100Km,
                evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source,
            }, periodRewards);
        }
    }
    const homeTodaySum = buildHomeSummary("today", day.home, reasonsHome);
    const homeMonthSum = buildHomeSummary("month", homeMonth, reasonsHome, {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    });
    const homePeriodSum = buildHomeSummary(periodId, homePeriod, [...reasonsHome, ...reasonsPeriod], periodMeta);
    const mobTodaySum = buildMobilitySummary("today", day.mobility, openSessions, reasonsMob);
    const mobMonthSum = buildMobilitySummary("month", mobMonth, openSessions, reasonsMob, {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    });
    const mobPeriodSum = buildMobilitySummary(periodId, mobPeriod, openSessions, [...reasonsMob, ...reasonsPeriod], periodMeta);
    const safeCfg = {
        enabled: cfg.enabled,
        compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
        compareTariffMonthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
        tibberMonthlyBaseEur: cfg.tibberMonthlyBaseEur,
        tibberMonthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
        iceFuelType: cfg.iceFuelType,
        iceLPer100Km: cfg.iceLPer100Km,
        gridRewardsEnabled: cfg.gridRewardsEnabled,
    };
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.enabled, true);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.lastRunAt, now.toISOString());
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.configJson, JSON.stringify(safeCfg));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.periodOptionsJson, JSON.stringify(periodOptions));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeTodayJson, JSON.stringify(homeTodaySum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeMonthJson, JSON.stringify(homeMonthSum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homePeriodJson, JSON.stringify(homePeriodSum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityTodayJson, JSON.stringify(mobTodaySum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityMonthJson, JSON.stringify(mobMonthSum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityPeriodJson, JSON.stringify(mobPeriodSum));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeTodaySavingsEur, day.home.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeMonthSavingsEur, homeMonth.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homePeriodSavingsEur, homePeriod.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityTodaySavingsEur, day.mobility.savingsVsIceEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityMonthSavingsEur, mobMonth.savingsVsIceEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityPeriodSavingsEur, mobPeriod.savingsVsIceEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.publicPendingJson, JSON.stringify(day.publicSessions.filter((s) => s.status === "pending_invoice")));
    const reason = [
        homeTodaySum.savingsVsFixedEur !== null
            ? `Haus heute Tibber vs. Festtarif: ${homeTodaySum.savingsVsFixedEur.toFixed(2)} €.`
            : reasonsHome[0] ?? "Haus: Daten unvollständig.",
        homePeriodSum.savingsVsFixedEur !== null
            ? `Haus ${periodMeta.periodLabelDe}: ${homePeriodSum.savingsVsFixedEur.toFixed(2)} €.`
            : reasonsPeriod[0] ?? "",
        mobTodaySum.savingsVsIceEur !== null
            ? `Mobilität heute vs. Verbrenner: ${mobTodaySum.savingsVsIceEur.toFixed(2)} €.`
            : reasonsMob[0] ?? "Mobilität: Daten unvollständig.",
        mobPeriodSum.savingsVsIceEur !== null
            ? `Mobilität ${periodMeta.periodLabelDe}: ${mobPeriodSum.savingsVsIceEur.toFixed(2)} €.`
            : "",
        openSessions > 0 ? `${openSessions} Schnellader-Session(s) ohne Rechnung.` : "",
    ]
        .filter(Boolean)
        .join(" ");
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.reasonDe, reason);
    await flushPersist(host);
}
exports.tickStatistics = tickStatistics;
function __resetStatisticsForTest() {
    persistCache = null;
    persistDirty = false;
}
exports.__resetStatisticsForTest = __resetStatisticsForTest;
function isStatisticsRelatedState(relativeId) {
    return (relativeId === ensure_states_1.STATISTICS_STATES.publicSubmitRequest ||
        relativeId === ensure_states_1.STATISTICS_STATES.adjustRequest ||
        relativeId.startsWith("statistics."));
}
exports.isStatisticsRelatedState = isStatisticsRelatedState;
async function handleStatisticsStateChange(host, relativeId, val, ack) {
    // period_id: VIS kann mit ack:true schreiben — trotzdem neu rechnen.
    if (relativeId === ensure_states_1.STATISTICS_STATES.periodId) {
        const normalized = (0, period_1.normalizePeriodId)(val, "this_month");
        const cur = await host.getStateAsync(ensure_states_1.STATISTICS_STATES.periodId);
        if (cur?.val !== normalized || cur?.ack !== true) {
            await host.setStateAsync(ensure_states_1.STATISTICS_STATES.periodId, { val: normalized, ack: true });
        }
        await tickStatistics(host);
        return true;
    }
    if ((relativeId !== ensure_states_1.STATISTICS_STATES.publicSubmitRequest &&
        relativeId !== ensure_states_1.STATISTICS_STATES.adjustRequest) ||
        ack) {
        return relativeId.startsWith("statistics.");
    }
    void val;
    await tickStatistics(host);
    return true;
}
exports.handleStatisticsStateChange = handleStatisticsStateChange;

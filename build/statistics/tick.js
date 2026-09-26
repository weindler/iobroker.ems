"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStatisticsStateChange = exports.isStatisticsRelatedState = exports.__resetStatisticsForTest = exports.tickStatistics = exports.legacyDailyChargesForKeys = void 0;
const state_util_1 = require("../ems_light/state_util");
const config_1 = require("./config");
const compute_1 = require("./compute");
const grid_rewards_1 = require("./grid_rewards");
const period_1 = require("./period");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const public_charge_1 = require("./public_charge");
const adjust_1 = require("./adjust");
const flat_states_1 = require("./flat_states");
const persist_2 = require("../learning/day_telemetry/persist");
const energy_1 = require("./energy");
const reconcile_1 = require("./reconcile");
const mobility_cost_1 = require("./mobility_cost");
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
/** Alte EMS-Statistiktage erhalten, für die noch keine Viertelstundenmessung existiert. */
function legacyDailyChargesForKeys(days, keys) {
    return keys.flatMap((key) => {
        const day = days[key];
        if (!day || (day.energy?.evChargedKwh != null && day.energy.evChargedKwh > 0))
            return [];
        const pv = day.mobility.homePvKwh ?? 0;
        const grid = day.mobility.homeGridKwh ?? 0;
        const charged = pv + grid;
        return Number.isFinite(charged) && charged > 0
            ? [{ dateKey: key, chargedKwh: Math.round(charged * 1000) / 1000 }]
            : [];
    });
}
exports.legacyDailyChargesForKeys = legacyDailyChargesForKeys;
function measuredChargeForKeys(days, keys) {
    let charged = 0;
    let cost = 0;
    let hasCharge = false;
    let missing = false;
    let invoicedKwh = 0;
    let invoicedEur = 0;
    let pending = 0;
    for (const key of keys) {
        const day = days[key];
        if (!day)
            continue;
        const energy = day.energy?.evChargedKwh ?? 0;
        if (energy > 0) {
            hasCharge = true;
            if (day.mobility.provisionalCostEur === null || day.mobility.provisionalCostEur === undefined ||
                day.mobility.provisionalChargedKwh == null ||
                Math.abs(energy - day.mobility.provisionalChargedKwh) > 0.05)
                missing = true;
            else {
                charged += day.mobility.provisionalChargedKwh;
                cost += day.mobility.provisionalCostEur;
            }
        }
        const invoice = (0, public_charge_1.invoicedPublicTotals)(day.publicSessions);
        invoicedKwh += invoice.kwh;
        invoicedEur += invoice.eur;
        pending += day.publicSessions.filter((session) => session.status === "pending_invoice").length;
    }
    return { chargedKwh: hasCharge && !missing ? Math.round(charged * 1000) / 1000 : hasCharge ? null : 0,
        costEur: hasCharge && !missing ? Math.round(cost * 100) / 100 : hasCharge ? null : 0,
        invoicedKwh: Math.round(invoicedKwh * 1000) / 1000,
        invoicedEur: Math.round(invoicedEur * 100) / 100, pending };
}
function rewardsForRangeFinal(persist, fromKey, toKey, todayKey, enabled) {
    if (toKey >= todayKey)
        return false;
    if (!enabled)
        return true;
    let month = fromKey.slice(0, 7);
    while (month <= toKey.slice(0, 7)) {
        if (persist.monthRewardsBilling?.[month]?.creditEur == null)
            return false;
        const [year, part] = month.split("-").map(Number);
        const lastDay = new Date(year, part, 0).getDate();
        if (fromKey > `${month}-01` || toKey < `${month}-${String(lastDay).padStart(2, "0")}`)
            return false;
        month = `${year + (part === 12 ? 1 : 0)}-${String(part === 12 ? 1 : part + 1).padStart(2, "0")}`;
    }
    return true;
}
function buildHomeSummary(period, home, reasonParts, meta) {
    return {
        period,
        periodLabelDe: meta?.periodLabelDe,
        fromKey: meta?.fromKey,
        toKey: meta?.toKey,
        gridImportKwh: home.gridImportKwh,
        gridExportKwh: home.gridExportKwh,
        feedInCreditEur: home.feedInCreditEur,
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
        publicInvoicedEur: mob.publicInvoicedEur,
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
/**
 * Übernimmt die kompakte energetische Tagesbilanz in das langfristige Statistik-Ledger.
 * Abgeschlossene Tage werden nur einmal gelesen; der laufende Tag wird aktualisiert.
 */
async function syncEnergeticTelemetry(host, persist, todayKey, feedInCtPerKwh) {
    const dir = baseDir(host);
    if (!dir)
        return;
    const telemetryDir = host.getAbsolutePath?.(persist_2.DAY_TELEMETRY_CATEGORY);
    if (!telemetryDir)
        return;
    const keys = await (0, persist_2.listDayTelemetryDateKeys)(telemetryDir);
    for (const key of keys) {
        if (key > todayKey)
            continue;
        const existing = persist.days[key]?.energy;
        const hasFastChargeSchema = existing != null &&
            Object.prototype.hasOwnProperty.call(existing, "evFastChargedKwh") &&
            Object.prototype.hasOwnProperty.call(existing, "evFastBatteryKwh") &&
            Object.prototype.hasOwnProperty.call(existing, "evFastGridKwh") &&
            Object.prototype.hasOwnProperty.call(existing, "evFastLocalKwh");
        const previousMobility = persist.days[key]?.mobility;
        if (key !== todayKey && existing?.complete && hasFastChargeSchema &&
            previousMobility?.provisionalCostEur !== undefined && persist.days[key]?.chargeRuns !== undefined &&
            (persist.days[key].chargeRuns.length > 0 || !(existing.evChargedKwh !== null && existing.evChargedKwh > 0)))
            continue;
        const telemetry = await (0, persist_2.readDayTelemetryDay)(telemetryDir, key);
        if (!telemetry)
            continue;
        const next = (0, energy_1.buildEnergeticDayTotals)(telemetry);
        const target = ensureDay(persist, key);
        const priced = (0, mobility_cost_1.measuredMobilityCost)(telemetry, feedInCtPerKwh);
        if (JSON.stringify(target.chargeRuns ?? null) !== JSON.stringify(priced?.runs ?? [])) {
            target.chargeRuns = priced?.runs ?? [];
            persistDirty = true;
        }
        if (JSON.stringify(target.energy ?? null) !== JSON.stringify(next)) {
            target.energy = next;
            persistDirty = true;
        }
        if (target.mobility.provisionalCostEur !== (priced?.costEur ?? null) ||
            target.mobility.provisionalChargedKwh !== (priced?.chargedKwh ?? null)) {
            target.mobility.provisionalChargedKwh = priced?.chargedKwh ?? null;
            target.mobility.provisionalPvKwh = priced?.pvKwh ?? null;
            target.mobility.provisionalOtherKwh = priced?.otherKwh ?? null;
            target.mobility.provisionalCostEur = priced?.costEur ?? null;
            persistDirty = true;
        }
    }
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
    const dateKey = submit.date ?? (0, compute_1.localDateKey)(now);
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
    await syncEnergeticTelemetry(host, persist, dateKey, cfg.feedInCtPerKwh);
    const day = ensureDay(persist, dateKey);
    const rt = persist.runtime;
    const nowMs = now.getTime();
    const dtSec = rt.lastTickMs !== null && nowMs > rt.lastTickMs
        ? Math.min(600, (nowMs - rt.lastTickMs) / 1000)
        : 0;
    if (rt.meterCaptureSinceIso === undefined)
        rt.meterCaptureSinceIso = null;
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
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.meterLivePowerW, gridImportPowerW ?? null);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.meterImport180Kwh, gridImportEnergy ?? null);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.meterExport280Kwh, gridExportEnergy ?? null);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.meterSourceDe, cfg.gridImportEnergyKwhStateId || cfg.gridExportEnergyKwhStateId
        ? "Reale kumulative Zählerstände; Tages- und Zeitraumwerte aus Differenzen"
        : "nicht konfiguriert");
    // --- Haus: Import-Energie ---
    let importKwhToday = day.home.gridImportKwh ?? 0;
    let haveImport = day.home.gridImportKwh !== null;
    if (cfg.gridImportEnergyKwhStateId) {
        if (gridImportEnergy !== null && rt.meterCaptureSinceIso === null)
            rt.meterCaptureSinceIso = now.toISOString();
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
        if (gridExportEnergy !== null && rt.meterCaptureSinceIso === null)
            rt.meterCaptureSinceIso = now.toISOString();
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
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.meterCaptureSince, rt.meterCaptureSinceIso ?? "");
    if (day.energy && (cfg.gridImportEnergyKwhStateId || cfg.gridExportEnergyKwhStateId)) {
        day.energy = (0, energy_1.reconcileEnergeticGridTruth)(day.energy, {
            gridImportKwh: day.home.gridImportKwh,
            gridExportKwh: day.home.gridExportKwh,
            captureSinceIso: rt.meterCaptureSinceIso,
        });
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
    const energyMonth = (0, energy_1.sumEnergeticDays)(monthDayKeys.map((k) => persist.days[k].energy), {
        period: "month",
        periodLabelDe: "Dieser Monat",
        fromKey: `${dateKey.slice(0, 7)}-01`,
        toKey: dateKey,
    });
    const homeMonthPersist = (0, compute_1.sumHomeDays)(monthHomes);
    const jsonDailyId = cfg.tibberJsonDailyStateId;
    const jsonMonthlyId = (0, compute_1.siblingTibberConsumptionState)(jsonDailyId, "jsonMonthly");
    const currentMonthKwhId = cfg.gridImportMonthKwhStateId ||
        (0, compute_1.siblingTibberConsumptionState)(jsonDailyId, "currentMonthConsumption");
    const jsonDailyRaw = jsonDailyId ? await readForeignRaw(host, jsonDailyId) : null;
    const jsonMonthlyRaw = jsonMonthlyId ? await readForeignRaw(host, jsonMonthlyId) : null;
    const tibberMonth = (0, compute_1.resolveHomeMonthFromTibber)({
        dateKey,
        jsonDailyRaw,
        jsonMonthlyRaw,
        currentMonthKwh: currentMonthKwhId ? await readForeignNum(host, currentMonthKwhId) : null,
        mappedMonthKwh: null,
        mappedMonthDynamicEur: cfg.dynamicCostMonthEurStateId
            ? await readForeignNum(host, cfg.dynamicCostMonthEurStateId)
            : null,
    });
    const reconciledTibberMonth = (0, compute_1.reconcileCurrentMonthWithToday)({
        dateKey,
        jsonDailyRaw,
        monthGridImportKwh: tibberMonth.gridImportKwh,
        monthDynamicCostEur: tibberMonth.dynamicCostEur,
        monthSource: tibberMonth.source,
        todayGridImportKwh: day.home.gridImportKwh,
        todayDynamicCostEur: day.home.dynamicCostEur,
    });
    const hasPairedTibberMonth = tibberMonth.source !== null &&
        tibberMonth.gridImportKwh !== null && tibberMonth.dynamicCostEur !== null &&
        reconciledTibberMonth.gridImportKwh !== null && reconciledTibberMonth.dynamicCostEur !== null;
    let homeMonth = homeMonthPersist;
    if (reconciledTibberMonth.gridImportKwh !== null || reconciledTibberMonth.dynamicCostEur !== null) {
        homeMonth = (0, compute_1.buildHomeMonthTotals)({
            dateKey,
            gridImportKwh: reconciledTibberMonth.gridImportKwh ?? homeMonthPersist.gridImportKwh,
            dynamicCostEur: reconciledTibberMonth.dynamicCostEur ?? homeMonthPersist.dynamicCostEur,
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
    const jsonDailyRawForStart = jsonDailyRaw;
    const statisticsStartKey = (0, period_1.resolveStatisticsStartKey)({
        adminStartKey: cfg.statisticsStartDate,
        persistDayKeys: Object.keys(persist.days),
        tibberEarliestKey: (0, compute_1.earliestTibberJsonDailyDateKey)(jsonDailyRawForStart),
    });
    const rawPeriodRange = (0, period_1.resolvePeriodRange)(periodId, dateKey);
    const periodRange = rawPeriodRange
        ? (0, period_1.clipPeriodRangeToStart)(rawPeriodRange, statisticsStartKey)
        : null;
    const periodOptions = (0, period_1.listPeriodOptions)(dateKey, Object.keys(persist.days));
    const reasonsPeriod = [];
    if (statisticsStartKey) {
        reasonsPeriod.push(`Statistik ab ${statisticsStartKey}.`);
    }
    let homePeriod = homeMonth;
    let mobPeriod = mobMonth;
    let pairedPeriodComparison = false;
    let periodMeta = {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    };
    if (periodRange === null && rawPeriodRange) {
        periodMeta = {
            periodLabelDe: rawPeriodRange.labelDe,
            fromKey: rawPeriodRange.fromKey,
            toKey: rawPeriodRange.toKey,
        };
        reasonsPeriod.push(`Zeitraum ${rawPeriodRange.labelDe} liegt vor Statistik-Start (${statisticsStartKey ?? "—"}) — keine Daten.`);
        homePeriod = (0, compute_1.emptyHomeDay)(dateKey);
        mobPeriod = (0, compute_1.emptyMobilityDay)(dateKey);
    }
    else if (periodRange) {
        periodMeta = {
            periodLabelDe: periodRange.labelDe,
            fromKey: periodRange.fromKey,
            toKey: periodRange.toKey,
        };
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
        const tibberRange = (0, compute_1.sumTibberPairedRange)({
            fromKey: periodRange.fromKey,
            toKey: periodRange.toKey,
            todayKey: dateKey,
            jsonDailyRaw: jsonDailyRawForStart,
            jsonMonthlyRaw,
            currentMonth: hasPairedTibberMonth ? reconciledTibberMonth : { gridImportKwh: null, dynamicCostEur: null },
        });
        if (tibberRange.coveredMonths && tibberRange.coveredMonths < tibberRange.totalMonths) {
            reasonsPeriod.push(`Tibber-Preisvergleich umfasst ${tibberRange.coveredMonths} von ${tibberRange.totalMonths} Monaten im ausgewählten Zeitraum; übrige Monate sind noch nicht belegbar.`);
        }
        // Bei gepaarten Tibber-Monatswerten muss der Festtarif dieselbe Monatsmenge
        // und denselben Grundpreisanteil nutzen. Nur Persistenz-Tage werden ab
        // Statistik-Start beschnitten.
        if (periodId === "this_month" && periodRange.fromKey === `${dateKey.slice(0, 7)}-01`) {
            const fixedClipped = (0, period_1.fixedTariffCostForRange)({
                gridImportKwh: homeMonth.gridImportKwh,
                compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
                monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
                fromKey: periodRange.fromKey,
                toKey: periodRange.toKey,
            });
            const fixedForPeriod = hasPairedTibberMonth ? homeMonth.fixedTariffCostEur : fixedClipped ?? homeMonth.fixedTariffCostEur;
            homePeriod = (0, compute_1.applyHomeGridRewards)({
                ...homeMonth,
                fixedTariffCostEur: fixedForPeriod,
                savingsVsFixedEur: (0, compute_1.savingsVsFixedEur)(fixedForPeriod, homeMonth.dynamicCostEur),
            }, monthRewards);
            mobPeriod = mobMonth;
        }
        else if (tibberRange.gridImportKwh === null &&
            tibberRange.dynamicCostEur === null &&
            !keys.length) {
            reasonsPeriod.push(`Zeitraum ${periodRange.labelDe}: keine Persistenz-Tage und kein Tibber jsonDaily in ${periodRange.fromKey}…${periodRange.toKey}.`);
            homePeriod = (0, compute_1.emptyHomeDay)(dateKey);
            mobPeriod = (0, compute_1.emptyMobilityDay)(dateKey);
        }
        else {
            let homeAgg = (0, compute_1.sumHomeDays)(periodHomes);
            if (tibberRange.gridImportKwh !== null || tibberRange.dynamicCostEur !== null) {
                const importKwh = tibberRange.gridImportKwh ?? homeAgg.gridImportKwh;
                const dynamic = tibberRange.dynamicCostEur ?? homeAgg.dynamicCostEur;
                const pairedPeriod = tibberRange.gridImportKwh !== null && tibberRange.dynamicCostEur !== null;
                pairedPeriodComparison = pairedPeriod;
                const fixed = pairedPeriod ? tibberRange.segments.reduce((sum, segment) => {
                    const value = (0, period_1.fixedTariffCostForRange)({
                        gridImportKwh: segment.gridImportKwh,
                        compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
                        monthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
                        fromKey: segment.fromKey,
                        toKey: segment.toKey,
                    });
                    return sum === null || value === null ? null : Math.round((sum + value) * 100) / 100;
                }, 0) : (0, period_1.fixedTariffCostForRange)({
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
                    savingsVsFixedEur: (0, compute_1.savingsVsFixedEur)(fixed, dynamic),
                }, periodRewards);
            }
            else {
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
                    savingsVsFixedEur: (0, compute_1.savingsVsFixedEur)(fixed, homeAgg.dynamicCostEur),
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
    const energyPeriodKeys = periodRange
        ? (0, period_1.dayKeysInRange)(persist.days, periodRange.fromKey, periodRange.toKey)
        : [];
    const energyPeriod = (0, energy_1.sumEnergeticDays)(energyPeriodKeys.map((key) => persist.days[key]?.energy), {
        period: periodId,
        periodLabelDe: periodMeta.periodLabelDe,
        fromKey: periodMeta.fromKey,
        toKey: periodMeta.toKey,
    });
    const legacyPeriodCharges = legacyDailyChargesForKeys(persist.days, energyPeriodKeys);
    const legacyPeriodKwh = legacyPeriodCharges.reduce((sum, row) => sum + row.chargedKwh, 0);
    const comparedPeriodEnergy = legacyPeriodKwh > 0 ? { ...energyPeriod,
        evChargedKwh: Math.round(((energyPeriod.evChargedKwh ?? 0) + legacyPeriodKwh) * 1000) / 1000,
        evPvKwh: null, evPvSharePct: null } : energyPeriod;
    const homeTodaySum = (0, reconcile_1.reconcileHomeEnergy)(buildHomeSummary("today", day.home, reasonsHome, { periodLabelDe: "Heute", fromKey: dateKey, toKey: dateKey }), day.energy, { feedInCtPerKwh: cfg.feedInCtPerKwh });
    const homeMonthSum = (0, reconcile_1.reconcileHomeEnergy)(buildHomeSummary("month", homeMonth, reasonsHome, {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    }), energyMonth, { preserveTibberMonthlyComparison: hasPairedTibberMonth, feedInCtPerKwh: cfg.feedInCtPerKwh });
    const homePeriodSum = (0, reconcile_1.reconcileHomeEnergy)(buildHomeSummary(periodId, homePeriod, [...reasonsHome, ...reasonsPeriod], periodMeta), energyPeriod, { preserveTibberMonthlyComparison: periodId === "this_month" && periodRange?.fromKey === `${dateKey.slice(0, 7)}-01`
            ? hasPairedTibberMonth : pairedPeriodComparison,
        feedInCtPerKwh: cfg.feedInCtPerKwh });
    const mobilityOptions = (keys, fromKey, toKey, rewards) => {
        const measured = measuredChargeForKeys(persist.days, keys);
        return { iceLPer100Km: cfg.iceLPer100Km,
            provisionalHomeCostEur: measured.costEur,
            provisionalChargedKwh: measured.chargedKwh,
            invoicedKwh: measured.invoicedKwh,
            invoicedEur: measured.invoicedEur,
            pendingInvoices: measured.pending,
            billedRewardsEur: rewards.source === "billing" ? rewards.creditEur : null,
            finalized: measured.pending === 0 && rewardsForRangeFinal(persist, fromKey, toKey, dateKey, cfg.gridRewardsEnabled),
        };
    };
    const mobTodaySum = (0, reconcile_1.reconcileMobilityEnergy)(buildMobilitySummary("today", day.mobility, openSessions, reasonsMob), day.energy, mobilityOptions([dateKey], dateKey, dateKey, todayRewards));
    const mobMonthSum = (0, reconcile_1.reconcileMobilityEnergy)(buildMobilitySummary("month", mobMonth, openSessions, reasonsMob, {
        periodLabelDe: "Dieser Monat",
        fromKey: dateKey.slice(0, 7) + "-01",
        toKey: dateKey,
    }), energyMonth, mobilityOptions(monthDayKeys, dateKey.slice(0, 7) + "-01", dateKey, monthRewards));
    const mobPeriodSum = (0, reconcile_1.reconcileMobilityEnergy)(buildMobilitySummary(periodId, mobPeriod, openSessions, [...reasonsMob, ...reasonsPeriod], periodMeta), comparedPeriodEnergy, mobilityOptions(energyPeriodKeys, periodMeta.fromKey, periodMeta.toKey, periodId === "this_month" && periodMeta.fromKey === `${dateKey.slice(0, 7)}-01`
        ? monthRewards : (0, grid_rewards_1.resolvePeriodGridRewards)({ enabled: cfg.gridRewardsEnabled,
        fromKey: periodMeta.fromKey, toKey: periodMeta.toKey, todayKey: dateKey,
        mappedMonthEur: rewardsCreditMonth, monthRewardsBilling: persist.monthRewardsBilling ?? {},
        dayCredits: energyPeriodKeys.map((key) => ({ dateKey: key,
            creditEur: persist.days[key].home.gridRewardsCreditEur })) })));
    const measuredChargeRows = energyPeriodKeys.flatMap((key) => persist.days[key]?.chargeRuns ?? [])
        .map((run) => {
        const km = evCons.value && evCons.value > 0 ? run.chargedKwh * 100 / evCons.value : null;
        const iceEur = (0, compute_1.iceCostForKm)({ km, lPer100Km: cfg.iceLPer100Km,
            fuelPriceEurPerL: fuelPrice }).costEur;
        return { ...run, kmEquivalent: km === null ? null : Math.round(km),
            iceCostEur: iceEur,
            advantageEur: iceEur === null || run.costEur === null ? null : Math.round((iceEur - run.costEur) * 100) / 100 };
    })
        .sort((a, b) => b.startedAtIso.localeCompare(a.startedAtIso));
    const groupedPeriod = periodId === "this_year" || periodId === "last_year" ||
        periodId === "this_quarter" || periodId === "last_quarter" || /^year_\d{4}$/.test(periodId);
    if (!groupedPeriod)
        mobPeriodSum.chargeRuns = measuredChargeRows;
    if (!groupedPeriod)
        mobPeriodSum.legacyDailyCharges = legacyPeriodCharges;
    if (periodRange && groupedPeriod) {
        const rows = [];
        let month = periodRange.fromKey.slice(0, 7);
        while (month <= periodRange.toKey.slice(0, 7) && rows.length < 120) {
            const [y, m] = month.split("-").map(Number);
            const first = `${month}-01`;
            const last = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
            const fromKey = first < periodRange.fromKey ? periodRange.fromKey : first;
            const toKey = last > periodRange.toKey ? periodRange.toKey : last;
            const monthKeys = (0, period_1.dayKeysInRange)(persist.days, fromKey, toKey);
            const monthPrices = (0, compute_1.sumTibberPairedRange)({ fromKey, toKey, todayKey: dateKey,
                jsonDailyRaw, jsonMonthlyRaw,
                currentMonth: hasPairedTibberMonth ? reconciledTibberMonth : { gridImportKwh: null, dynamicCostEur: null } });
            const priceSegment = monthPrices.segments[0];
            const fixedCost = priceSegment ? (0, period_1.fixedTariffCostForRange)({ gridImportKwh: priceSegment.gridImportKwh,
                compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
                monthlyBaseEur: cfg.compareTariffMonthlyBaseEur, fromKey, toKey }) : null;
            const monthEnergy = (0, energy_1.sumEnergeticDays)(monthKeys.map((key) => persist.days[key]?.energy), { period: `month_${month}`, periodLabelDe: month, fromKey, toKey });
            const legacyMonthKwh = legacyDailyChargesForKeys(persist.days, monthKeys)
                .reduce((sum, row) => sum + row.chargedKwh, 0);
            const comparedMonthEnergy = legacyMonthKwh > 0 ? { ...monthEnergy,
                evChargedKwh: Math.round(((monthEnergy.evChargedKwh ?? 0) + legacyMonthKwh) * 1000) / 1000,
                evPvKwh: null, evPvSharePct: null } : monthEnergy;
            const billed = persist.monthRewardsBilling?.[month]?.creditEur ?? null;
            const wholeMonth = fromKey === first && toKey === last;
            const monthMob = (0, compute_1.sumMobilityDays)(monthKeys.map((key) => persist.days[key].mobility), { evKwhPer100: evCons.value, fuelPriceEurPerL: fuelPrice,
                iceLPer100Km: cfg.iceLPer100Km,
                evKwhPer100KmSource: evCons.source === "missing" ? null : evCons.source }, { creditEur: wholeMonth ? billed : null, source: wholeMonth && billed !== null ? "billing" : "off" });
            const monthlyOptions = mobilityOptions(monthKeys, fromKey, toKey, { creditEur: wholeMonth ? billed : null, source: wholeMonth && billed !== null ? "billing" : "off" });
            monthlyOptions.finalized = monthlyOptions.finalized && monthEnergy.daysWithTelemetry === monthEnergy.daysTotal;
            const monthly = (0, reconcile_1.reconcileMobilityEnergy)(buildMobilitySummary(`month_${month}`, monthMob, 0, []), comparedMonthEnergy, monthlyOptions);
            rows.push({ month, fromKey, toKey,
                homeSavingsEur: (0, compute_1.savingsVsFixedEur)(fixedCost, priceSegment?.dynamicCostEur ?? null),
                gridImportKwh: priceSegment?.gridImportKwh ?? null,
                chargedKwh: monthly.homeChargedKwh ?? null,
                evCostEur: monthly.evTotalCostEur ?? monthly.estimatedEvCostEur ?? null,
                iceCostEur: monthly.iceCostEur,
                mobilitySavingsEur: monthly.savingsVsIceEur ?? monthly.estimatedSavingsVsIceEur ?? null,
                status: monthly.comparisonStatus ?? "unvollständig" });
            month = `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
        }
        mobPeriodSum.monthlyBreakdown = rows;
    }
    const safeCfg = {
        enabled: cfg.enabled,
        compareTariffCtPerKwh: cfg.compareTariffCtPerKwh,
        compareTariffMonthlyBaseEur: cfg.compareTariffMonthlyBaseEur,
        tibberMonthlyBaseEur: cfg.tibberMonthlyBaseEur,
        tibberMonthlyGridFeeEur: cfg.tibberMonthlyGridFeeEur,
        iceFuelType: cfg.iceFuelType,
        iceLPer100Km: cfg.iceLPer100Km,
        gridRewardsEnabled: cfg.gridRewardsEnabled,
        feedInCtPerKwh: cfg.feedInCtPerKwh,
        batteryWearCostCtPerKwh: cfg.batteryWearCostCtPerKwh,
        statisticsStartDate: cfg.statisticsStartDate,
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
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.energyTodayJson, JSON.stringify(day.energy ?? null));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.energyMonthJson, JSON.stringify(energyMonth));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.energyPeriodJson, JSON.stringify(energyPeriod));
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeTodaySavingsEur, homeTodaySum.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homeMonthSavingsEur, homeMonthSum.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.homePeriodSavingsEur, homePeriodSum.savingsVsFixedEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityTodaySavingsEur, mobTodaySum.savingsVsIceEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityMonthSavingsEur, mobMonthSum.savingsVsIceEur);
    await setIfChanged(host, ensure_states_1.STATISTICS_STATES.mobilityPeriodSavingsEur, mobPeriodSum.savingsVsIceEur);
    const flatSet = (id, val) => setIfChanged(host, id, val);
    await setIfChanged(host, flat_states_1.STATISTICS_FLAT.statisticsStartDate, statisticsStartKey ?? "");
    await (0, flat_states_1.publishHomeFlat)(flatSet, flat_states_1.STATISTICS_FLAT.homeToday, homeTodaySum, "Heute");
    await (0, flat_states_1.publishHomeFlat)(flatSet, flat_states_1.STATISTICS_FLAT.homePeriod, homePeriodSum, periodMeta.periodLabelDe);
    await (0, flat_states_1.publishMobilityFlat)(flatSet, flat_states_1.STATISTICS_FLAT.mobilityToday, mobTodaySum, "Heute");
    await (0, flat_states_1.publishMobilityFlat)(flatSet, flat_states_1.STATISTICS_FLAT.mobilityPeriod, mobPeriodSum, periodMeta.periodLabelDe);
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
        try {
            if (typeof host.getAbsolutePath === "function") {
                const { tickEconomics } = await import("../economics/tick.js");
                await tickEconomics(host);
            }
        }
        catch {
            /* Economics folgt demselben Zeitraum; Fehler hier dürfen die Statistik nicht blockieren. */
        }
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

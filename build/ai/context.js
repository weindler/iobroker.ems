"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiOptimizationContext = exports.buildLearningDigest = exports.addonFlexPowerInSlot = exports.resolveAllowedAddonIds = void 0;
const registry_1 = require("../addons/governance/registry");
const config_1 = require("../addons/governance/config");
const state_util_1 = require("../ems_light/state_util");
/** Nur Add-ons, die aktiv UND per Governance für KI-Optimierung freigegeben sind — sonst darf die KI sie nicht mal erwähnen. */
function resolveAllowedAddonIds(config) {
    return (0, registry_1.governedAddonIds)().filter((id) => (0, config_1.isAddonEnabled)(config, id) && (0, config_1.isAddonAiOptimizationAllowed)(config, id));
}
exports.resolveAllowedAddonIds = resolveAllowedAddonIds;
/** Summe der flexiblen (nicht-mandatory) Allokation eines Add-on-Präfixes in einem Slot. */
function addonFlexPowerInSlot(slot, contributionPrefix) {
    let sum = 0;
    for (const a of slot.allocations) {
        if (a.mandatory)
            continue;
        if (!a.contributionId.startsWith(contributionPrefix))
            continue;
        sum += a.allocatedPowerW ?? 0;
    }
    return sum;
}
exports.addonFlexPowerInSlot = addonFlexPowerInSlot;
function addonAnyPowerInSlot(slot, contributionPrefix) {
    let sum = 0;
    for (const a of slot.allocations) {
        if (!a.contributionId.startsWith(contributionPrefix))
            continue;
        sum += a.allocatedPowerW ?? 0;
    }
    return sum;
}
/** Vollständige Slot-Zeilen über den gesamten Daily-Plan-Horizont (Block 6 — kein slot-only-Minimalkontext). */
function buildSlotDigest(plan, allowedAddonIds) {
    const ihAllowed = allowedAddonIds.includes("immersion_heater");
    const acAllowed = allowedAddonIds.includes("climate");
    const ihPrefix = (0, registry_1.governedAddonEntry)("immersion_heater").runtimeAddonId;
    const acPrefix = (0, registry_1.governedAddonEntry)("climate").runtimeAddonId;
    const batPrefix = (0, registry_1.governedAddonEntry)("battery").runtimeAddonId;
    const wbPrefix = (0, registry_1.governedAddonEntry)("wallbox").runtimeAddonId;
    return plan.slots.map((slot) => ({
        t: slot.slot.startIso,
        priceCtPerKwh: slot.gridPriceCtPerKwh,
        pvSurplusW: slot.availablePvSurplusPowerW,
        houseLoadW: slot.fixedHouseLoadPowerW,
        ihFlexW: ihAllowed ? Math.round(addonFlexPowerInSlot(slot, ihPrefix)) : 0,
        acW: acAllowed ? Math.round(addonFlexPowerInSlot(slot, acPrefix)) : 0,
        batteryChargeW: Math.round(addonAnyPowerInSlot(slot, batPrefix)),
        wallboxW: Math.round(addonAnyPowerInSlot(slot, wbPrefix)),
        allocatedPvW: Math.round(slot.allocatedPvPowerW),
        allocatedGridW: Math.round(slot.allocatedGridPowerW),
    }));
}
function digestFromDailyPlan(plan, allowedAddonIds) {
    return {
        date: plan.date,
        globalMode: plan.globalMode,
        status: plan.status,
        timezone: plan.timezone,
        slotMinutes: plan.slotMinutes,
        horizonSlotCount: plan.slots.length,
        validUntil: plan.validUntil,
        activeContributionIds: plan.activeContributionIds,
        excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId),
        totals: {
            pvForecastEnergyKwh: plan.totals.pvForecastEnergyKwh,
            fixedHouseLoadEnergyKwh: plan.totals.fixedHouseLoadEnergyKwh,
            flexibleRequestedEnergyKwh: plan.totals.flexibleRequestedEnergyKwh,
            flexibleAllocatedEnergyKwh: plan.totals.flexibleAllocatedEnergyKwh,
            flexibleUnallocatedEnergyKwh: plan.totals.flexibleUnallocatedEnergyKwh,
            pvAllocatedEnergyKwh: plan.totals.pvAllocatedEnergyKwh,
            gridAllocatedEnergyKwh: plan.totals.gridAllocatedEnergyKwh,
            batteryChargeEnergyKwh: plan.totals.batteryChargeEnergyKwh,
            wallboxEnergyKwh: plan.totals.wallboxEnergyKwh,
            immersionHeaterEnergyKwh: plan.totals.immersionHeaterEnergyKwh,
            airConditioningEnergyKwh: plan.totals.airConditioningEnergyKwh,
            estimatedGridCostCt: plan.totals.estimatedGridCostCt,
        },
        unallocated: plan.unallocated.map((u) => ({
            contributionId: u.contributionId,
            unallocatedEnergyKwh: u.unallocatedEnergyKwh,
            reasonDe: u.reasonDe,
        })),
        slots: buildSlotDigest(plan, allowedAddonIds),
    };
}
async function readStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val == null)
            return null;
        const s = String(st.val).trim();
        return s.length > 0 ? s : null;
    }
    catch {
        return null;
    }
}
async function readNum(host, id) {
    try {
        return (0, state_util_1.asNum)((await host.getStateAsync(id))?.val);
    }
    catch {
        return null;
    }
}
async function readJson(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (typeof st?.val !== "string" || !st.val)
            return {};
        const parsed = JSON.parse(st.val);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Kuratierter Learning-Digest — Skalare aus Learning-States, keine History-Dumps. */
async function buildLearningDigest(host) {
    const [pvBiasStatus, pvToday, pvTomorrow, thermalStatus, thermalEmpty, batteryStatus, topOffDays, priceStatus, priceAvg, houseStatus,] = await Promise.all([
        readStr(host, "learning.pv_bias.status"),
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readStr(host, "learning.thermal_runtime.status"),
        readStr(host, "learning.thermal_runtime.estimated_empty_at"),
        readStr(host, "learning.battery_runtime.status"),
        readNum(host, "learning.battery_runtime.topoff_interval_days"),
        readStr(host, "learning.price_learning.status"),
        readNum(host, "learning.price_learning.avg_price_7d"),
        readStr(host, "learning.house_load.status"),
    ]);
    return {
        pvBiasStatus,
        pvCorrectedTodayKwh: pvToday,
        pvCorrectedTomorrowKwh: pvTomorrow,
        thermalRuntimeStatus: thermalStatus,
        thermalEstimatedEmptyAt: thermalEmpty,
        batteryRuntimeStatus: batteryStatus,
        batteryTopOffIntervalDays: topOffDays,
        priceLearningStatus: priceStatus,
        priceAvgEurPerKwh7d: priceAvg,
        houseLoadStatus: houseStatus,
    };
}
exports.buildLearningDigest = buildLearningDigest;
/** Nur ausgewählte, unkritische Policy-Kennzahlen — kein voller Snapshot. */
function pickPolicyHighlights(policy) {
    const limits = policy.limits;
    const economics = policy.economics;
    return {
        houseFuseLimitW: limits?.houseFuseLimitW?.value ?? null,
        maxGridImportW: limits?.maxGridImportW?.value ?? null,
        gridImportAllowed: economics?.gridImportAllowed?.value ?? null,
    };
}
async function buildAiOptimizationContext(host, plan, triggerReason) {
    const policyRaw = await readJson(host, "policy.global.effective_json");
    const allowedAddonIds = resolveAllowedAddonIds(host.config);
    const learning = await buildLearningDigest(host);
    return {
        generatedAt: new Date().toISOString(),
        timezone: plan.timezone,
        globalMode: plan.globalMode,
        allowedAddonIds,
        dailyPlan: digestFromDailyPlan(plan, allowedAddonIds),
        learning,
        policyHighlights: pickPolicyHighlights(policyRaw),
        triggerReason,
    };
}
exports.buildAiOptimizationContext = buildAiOptimizationContext;

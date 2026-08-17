"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiOptimizationContext = exports.buildSituationBrief = exports.buildLearningDigest = exports.addonFlexPowerInSlot = exports.resolveAllowedAddonIds = void 0;
const registry_1 = require("../addons/governance/registry");
const config_1 = require("../addons/governance/config");
const ensure_evcc_states_1 = require("../addons/wallbox/ensure_evcc_states");
const types_1 = require("../addons/immersion_heater/runtime/types");
const ensure_states_1 = require("../addons/air_conditioning/runtime/ensure_states");
const constants_1 = require("../learning/pv_horizon/constants");
const state_util_1 = require("../ems_light/state_util");
const math_1 = require("../learning/thermal_runtime/math");
const time_1 = require("../operator/time");
const config_2 = require("../learning/battery_runtime/config");
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
async function readBool(host, id) {
    try {
        return (0, state_util_1.asBool)((await host.getStateAsync(id))?.val);
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
function validIsoDeadline(raw) {
    if (!raw?.trim())
        return null;
    if (raw.startsWith("0001-01-01T00:00:00"))
        return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function wallboxDeadlineFromPlan(plan) {
    let bestMs = null;
    let bestIso = null;
    for (const slot of plan.slots) {
        for (const a of slot.allocations) {
            if (!a.contributionId.startsWith("wallbox") || !a.deadlineIso)
                continue;
            const t = Date.parse(a.deadlineIso);
            if (!Number.isFinite(t))
                continue;
            if (bestMs === null || t < bestMs) {
                bestMs = t;
                bestIso = a.deadlineIso;
            }
        }
    }
    return bestIso;
}
function nextHoursFromPlan(plan) {
    const slotMs = plan.slotMinutes * 60_000;
    const windowMs = 4 * 3_600_000;
    const maxSlots = slotMs > 0 ? Math.ceil(windowMs / slotMs) : 16;
    const window = plan.slots.slice(0, maxSlots);
    if (window.length === 0) {
        return {
            avgPvForecastPowerW: null,
            avgAvailablePvSurplusPowerW: null,
            minPriceCt: null,
            maxPriceCt: null,
        };
    }
    const avgOrNull = (vals) => {
        const nums = vals.filter((v) => v !== null && Number.isFinite(v));
        if (nums.length === 0)
            return null;
        return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
    };
    const prices = window
        .map((s) => s.gridPriceCtPerKwh)
        .filter((v) => v !== null && Number.isFinite(v));
    return {
        avgPvForecastPowerW: avgOrNull(window.map((s) => s.pvForecastPowerW)),
        avgAvailablePvSurplusPowerW: avgOrNull(window.map((s) => s.availablePvSurplusPowerW)),
        minPriceCt: prices.length > 0 ? Math.min(...prices) : null,
        maxPriceCt: prices.length > 0 ? Math.max(...prices) : null,
    };
}
async function readPvHorizonDays(host) {
    const days = [];
    for (let d = 1; d <= constants_1.PV_HORIZON_DAY_COUNT; d++) {
        days.push({
            day: d,
            correctedKwh: await readNum(host, `learning.pv_horizon.day${d}.corrected_kwh`),
        });
    }
    return days;
}
/** Kuratierter Learning-Digest — Skalare aus Learning-States, keine History-Dumps. */
async function buildLearningDigest(host, timezone = "Europe/Berlin") {
    const [pvBiasStatus, pvToday, pvTomorrow, thermalStatus, thermalEmpty, batteryStatus, priceStatus, priceAvg, houseStatus, pvHorizonDays,] = await Promise.all([
        readStr(host, "learning.pv_bias.status"),
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readStr(host, "learning.thermal_runtime.status"),
        readStr(host, "learning.thermal_runtime.estimated_empty_at"),
        readStr(host, "learning.battery_runtime.status"),
        readStr(host, "learning.price_learning.status"),
        readNum(host, "learning.price_learning.avg_price_7d"),
        readStr(host, "learning.house_load.status"),
        readPvHorizonDays(host),
    ]);
    const topOffDays = (0, config_2.batteryRuntimeConfigFromAdapter)(host.config).topoffIntervalDays;
    return {
        pvBiasStatus,
        pvCorrectedTodayKwh: pvToday,
        pvCorrectedTomorrowKwh: pvTomorrow,
        pvHorizonDays,
        thermalRuntimeStatus: thermalStatus,
        thermalEstimatedEmptyAt: thermalEmpty,
        thermalEstimatedEmptyAtLocalDe: thermalEmpty
            ? (0, time_1.formatLocalDateTimeDe)(thermalEmpty, timezone)
            : null,
        thermalEstimatedRemainingHours: (0, math_1.liveRemainingHoursFromEmptyAt)(thermalEmpty, new Date()),
        batteryRuntimeStatus: batteryStatus,
        batteryTopOffIntervalDays: topOffDays,
        priceLearningStatus: priceStatus,
        priceAvgEurPerKwh7d: priceAvg,
        houseLoadStatus: houseStatus,
    };
}
exports.buildLearningDigest = buildLearningDigest;
/** Live + Horizont-Situation — fehlende Werte bleiben null (nie erfundene 0). */
async function buildSituationBrief(host, plan, learning) {
    const [pvPowerW, houseLoadW, surplusW, deficitW, wbConnected, wbCharging, wbMode, wbSoc, wbRemaining, wbLimitSoc, wbPlanActive, wbDeadlineRaw, bufferTempLive, bufferTempRuntime, climate1Running, climate1Temp, climate2Running, climate2Temp, priceNowCt,] = await Promise.all([
        readNum(host, "live.pv.power_w"),
        readNum(host, "live.battery.house_load_w"),
        readNum(host, "operator.diagnostics.surplus_w"),
        readNum(host, "operator.diagnostics.deficit_w"),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.loadpointMode),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh),
        readNum(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectiveLimitSocPct),
        readBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive),
        readStr(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime),
        readNum(host, "live.thermal.buffer_temp_c"),
        readNum(host, types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC),
        readBool(host, (0, ensure_states_1.acUnitRuntimeStates)(1).running),
        readNum(host, (0, ensure_states_1.acUnitRuntimeStates)(1).roomTempC),
        readBool(host, (0, ensure_states_1.acUnitRuntimeStates)(2).running),
        readNum(host, (0, ensure_states_1.acUnitRuntimeStates)(2).roomTempC),
        readNum(host, "live.price.now_ct_per_kwh"),
    ]);
    const deadlineIso = validIsoDeadline(wbDeadlineRaw) ?? wallboxDeadlineFromPlan(plan);
    return {
        live: {
            pvPowerW,
            houseLoadW,
            surplusW,
            deficitW,
        },
        wallbox: {
            connected: wbConnected,
            charging: wbCharging,
            mode: wbMode,
            socPct: wbSoc,
            remainingEnergyKwh: wbRemaining,
            effectiveLimitSoc: wbLimitSoc,
            planActive: wbPlanActive,
            deadlineIso,
        },
        immersion: {
            bufferTempC: bufferTempLive ?? bufferTempRuntime,
            thermalEstimatedEmptyAt: learning.thermalEstimatedEmptyAt,
            thermalEstimatedEmptyAtLocalDe: learning.thermalEstimatedEmptyAtLocalDe,
            thermalEstimatedRemainingHours: learning.thermalEstimatedRemainingHours,
        },
        climate: {
            units: [
                { unitIndex: 1, running: climate1Running, roomTempC: climate1Temp },
                { unitIndex: 2, running: climate2Running, roomTempC: climate2Temp },
            ],
        },
        pvHorizon: learning.pvHorizonDays,
        pvTodayKwh: learning.pvCorrectedTodayKwh,
        pvTomorrowKwh: learning.pvCorrectedTomorrowKwh,
        priceNowCt,
        priceAvg7d: learning.priceAvgEurPerKwh7d,
        nextHours: nextHoursFromPlan(plan),
    };
}
exports.buildSituationBrief = buildSituationBrief;
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
    const learning = await buildLearningDigest(host, plan.timezone || "Europe/Berlin");
    const situation = await buildSituationBrief(host, plan, learning);
    return {
        generatedAt: new Date().toISOString(),
        timezone: plan.timezone,
        globalMode: plan.globalMode,
        allowedAddonIds,
        dailyPlan: digestFromDailyPlan(plan, allowedAddonIds),
        learning,
        situation,
        policyHighlights: pickPolicyHighlights(policyRaw),
        triggerReason,
    };
}
exports.buildAiOptimizationContext = buildAiOptimizationContext;

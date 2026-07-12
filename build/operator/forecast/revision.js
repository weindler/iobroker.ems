"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBootstrapForecastPlanJson = exports.isUsableStoredForecastPlan = exports.parseForecastPlanFromJson = exports.forecastPlanSemanticRevisionHash = exports.forecastPlanRevisionPayload = void 0;
const node_crypto_1 = require("node:crypto");
/** Detail keys that must not bump revision when alone changed. */
const REVISION_OMIT_DETAIL_KEYS = new Set([
    "lastUpdate",
    "lastUpdateTs",
    "calculated_at",
    "calculatedAt",
    "runtimeId",
    "runtime_id",
    "generatedAt",
    "validUntil",
    "forecastHorizonStart",
    "forecastHorizonEnd",
    "todayDateKey",
    "tomorrowDateKey",
]);
function stripVolatileDetails(details) {
    const out = {};
    for (const [key, value] of Object.entries(details)) {
        if (REVISION_OMIT_DETAIL_KEYS.has(key))
            continue;
        out[key] = value;
    }
    return out;
}
function dayForRevision(day) {
    return {
        date: day.date,
        pvEnergyKwh: day.pvEnergyKwh,
        houseLoadEnergyKwh: day.houseLoadEnergyKwh,
        renewableBalanceKwh: day.renewableBalanceKwh,
        weatherMinTempC: day.weatherMinTempC,
        weatherMaxTempC: day.weatherMaxTempC,
    };
}
function slotForRevision(slot) {
    return {
        slot: slot.slot,
        pvPowerW: slot.pvPowerW,
        houseLoadPowerW: slot.houseLoadPowerW,
        fixedBalancePowerW: slot.fixedBalancePowerW,
        gridPriceCtPerKwh: slot.gridPriceCtPerKwh,
        gridImportAllowed: slot.gridImportAllowed,
        gridMaxImportPowerW: slot.gridMaxImportPowerW,
        outdoorTempC: slot.outdoorTempC,
    };
}
function excludedForRevision(entry) {
    return {
        contributionId: entry.contributionId,
        contributor: entry.contributor,
    };
}
function contributionForRevision(c) {
    return {
        contributionId: c.contributionId,
        flow: c.flow,
        contributor: c.contributor,
        roles: c.roles,
        enabled: c.enabled,
        quality: {
            status: c.quality.status,
            confidencePct: c.quality.confidencePct,
        },
        details: stripVolatileDetails(c.details),
    };
}
function horizonEndDateKey(horizonEnd) {
    return horizonEnd.slice(0, 10);
}
/** Semantic revision payload — energy/price core only, no volatile metadata. */
function forecastPlanRevisionPayload(plan) {
    const payload = {
        status: plan.status,
        timezone: plan.timezone,
        horizonEndDate: horizonEndDateKey(plan.horizonEnd),
        slotMinutes: plan.slotMinutes,
        activeContributors: plan.activeContributors,
        excludedContributors: plan.excludedContributors.map(excludedForRevision),
        days: plan.days.map(dayForRevision),
        slots: plan.slots.map(slotForRevision),
        contributions: plan.contributions.map(contributionForRevision),
    };
    return JSON.stringify(payload);
}
exports.forecastPlanRevisionPayload = forecastPlanRevisionPayload;
function forecastPlanSemanticRevisionHash(plan) {
    return (0, node_crypto_1.createHash)("sha256").update(forecastPlanRevisionPayload(plan)).digest("hex");
}
exports.forecastPlanSemanticRevisionHash = forecastPlanSemanticRevisionHash;
const USABLE_FORECAST_STATUSES = new Set(["ready", "degraded"]);
function parseForecastPlanFromJson(raw) {
    if (!raw || !raw.trim())
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.parseForecastPlanFromJson = parseForecastPlanFromJson;
function isUsableStoredForecastPlan(plan) {
    if (!plan)
        return false;
    return USABLE_FORECAST_STATUSES.has(plan.status);
}
exports.isUsableStoredForecastPlan = isUsableStoredForecastPlan;
function isBootstrapForecastPlanJson(raw) {
    if (!raw || raw.trim() === "" || raw.trim() === "{}")
        return false;
    return raw.length >= 100;
}
exports.isBootstrapForecastPlanJson = isBootstrapForecastPlanJson;

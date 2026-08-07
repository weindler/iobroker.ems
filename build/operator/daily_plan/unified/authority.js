"use strict";
/**
 * Unified Plan-Authority: ersetzt klassische Add-on-Allocations in DailyPlan.
 * IH/AC/Battery/Wallbox — eine Wahrheit für allocations_json + Addon-Slices.
 * Planner schreibt keine Geräte-States.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAllUnifiedAuthority = exports.clearIhAcAuthority = exports.applyUnifiedIhAcAuthority = exports.applyUnifiedDayAuthority = exports.isUnifiedManagedContributionId = exports.isWallboxContributionId = exports.isBatteryContributionId = exports.isIhAcContributionId = void 0;
function isIhAcContributionId(contributionId) {
    return (contributionId.startsWith("immersion_heater.") ||
        contributionId.startsWith("air_conditioning."));
}
exports.isIhAcContributionId = isIhAcContributionId;
function isBatteryContributionId(contributionId) {
    return contributionId.startsWith("battery.");
}
exports.isBatteryContributionId = isBatteryContributionId;
function isWallboxContributionId(contributionId) {
    return contributionId.startsWith("wallbox.");
}
exports.isWallboxContributionId = isWallboxContributionId;
function isUnifiedManagedContributionId(contributionId) {
    return (isIhAcContributionId(contributionId) ||
        isBatteryContributionId(contributionId) ||
        isWallboxContributionId(contributionId));
}
exports.isUnifiedManagedContributionId = isUnifiedManagedContributionId;
function stampAuthority(entries, meta) {
    const tag = `unified_day_plan; daily_plan_rev=${meta.dailyPlanRevision}; planId=${meta.unifiedPlanId}`;
    return entries.map((e) => {
        const base = e.reasonDe?.trim() ? e.reasonDe.trim() : "unified_day_plan";
        if (base.includes("daily_plan_rev="))
            return e;
        return { ...e, reasonDe: `${base}; ${tag}` };
    });
}
function sumEnergyKwh(entries) {
    return entries.reduce((s, e) => s + (e.allocatedEnergyKwh ?? 0), 0);
}
/**
 * Ersetzt Unified-managed Contributions in plan.allocations (+ Slot-Allocations).
 */
function applyUnifiedDayAuthority(plan, parts, meta) {
    const stampedIh = stampAuthority(parts.immersionEntries, meta);
    const stampedAc = stampAuthority(parts.climateEntries, meta);
    const stampedBat = parts.batteryEntries === null || parts.batteryEntries === undefined
        ? plan.allocations.filter((a) => isBatteryContributionId(a.contributionId))
        : stampAuthority(parts.batteryEntries, meta);
    const stampedWb = parts.wallboxEntries === null || parts.wallboxEntries === undefined
        ? plan.allocations.filter((a) => isWallboxContributionId(a.contributionId))
        : stampAuthority(parts.wallboxEntries, meta);
    const kept = plan.allocations.filter((a) => !isUnifiedManagedContributionId(a.contributionId));
    const allocations = [...kept, ...stampedIh, ...stampedAc, ...stampedBat, ...stampedWb];
    const slots = plan.slots.map((slot) => {
        const slotKept = slot.allocations.filter((a) => !isUnifiedManagedContributionId(a.contributionId));
        const start = slot.slot.startIso;
        const pick = (entries) => entries.filter((a) => a.slot.startIso === start);
        return {
            ...slot,
            allocations: [
                ...slotKept,
                ...pick(stampedIh),
                ...pick(stampedAc),
                ...pick(stampedBat),
                ...pick(stampedWb),
            ],
        };
    });
    return {
        ...plan,
        allocations,
        slots,
        totals: {
            ...plan.totals,
            immersionHeaterEnergyKwh: sumEnergyKwh(stampedIh),
            airConditioningEnergyKwh: sumEnergyKwh(stampedAc),
            batteryChargeEnergyKwh: sumEnergyKwh(stampedBat.filter((a) => a.contributionId === "battery.charge")),
            wallboxEnergyKwh: sumEnergyKwh(stampedWb),
        },
    };
}
exports.applyUnifiedDayAuthority = applyUnifiedDayAuthority;
/**
 * IH/AC Authority (Schritt 2/3): Battery/Wallbox bleiben unverändert (null = keep).
 */
function applyUnifiedIhAcAuthority(plan, immersionEntries, climateEntries, meta) {
    return applyUnifiedDayAuthority(plan, {
        immersionEntries,
        climateEntries,
        batteryEntries: null,
        wallboxEntries: null,
    }, meta);
}
exports.applyUnifiedIhAcAuthority = applyUnifiedIhAcAuthority;
/** AUTH-003: IH/AC idle. */
function clearIhAcAuthority(plan) {
    return applyUnifiedIhAcAuthority(plan, [], [], {
        dailyPlanRevision: plan.revision,
        unifiedPlanId: "unified-failed",
    });
}
exports.clearIhAcAuthority = clearIhAcAuthority;
/** Battery + Wallbox + IH/AC idle — kein Classic-Fallback. */
function clearAllUnifiedAuthority(plan) {
    return applyUnifiedDayAuthority(plan, {
        immersionEntries: [],
        climateEntries: [],
        batteryEntries: [],
        wallboxEntries: [],
    }, {
        dailyPlanRevision: plan.revision,
        unifiedPlanId: "unified-failed",
    });
}
exports.clearAllUnifiedAuthority = clearAllUnifiedAuthority;

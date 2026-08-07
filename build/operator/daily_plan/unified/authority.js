"use strict";
/**
 * IH/AC Plan-Authority: Unified ersetzt klassische Heizstab-/Klima-Allocations
 * in der bestehenden DailyPlan-Struktur. Battery/Wallbox bleiben klassisch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearIhAcAuthority = exports.applyUnifiedIhAcAuthority = exports.isIhAcContributionId = void 0;
function isIhAcContributionId(contributionId) {
    return (contributionId.startsWith("immersion_heater.") ||
        contributionId.startsWith("air_conditioning."));
}
exports.isIhAcContributionId = isIhAcContributionId;
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
 * Ersetzt IH/AC in plan.allocations (+ Slot-Allocations) durch Unified-Entries.
 * Battery/Wallbox und sonstige Contributions bleiben unverändert.
 */
function applyUnifiedIhAcAuthority(plan, immersionEntries, climateEntries, meta) {
    const stampedIh = stampAuthority(immersionEntries, meta);
    const stampedAc = stampAuthority(climateEntries, meta);
    const kept = plan.allocations.filter((a) => !isIhAcContributionId(a.contributionId));
    const allocations = [...kept, ...stampedIh, ...stampedAc];
    const slots = plan.slots.map((slot) => {
        const slotKept = slot.allocations.filter((a) => !isIhAcContributionId(a.contributionId));
        const start = slot.slot.startIso;
        const slotIh = stampedIh.filter((a) => a.slot.startIso === start);
        const slotAc = stampedAc.filter((a) => a.slot.startIso === start);
        return {
            ...slot,
            allocations: [...slotKept, ...slotIh, ...slotAc],
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
        },
    };
}
exports.applyUnifiedIhAcAuthority = applyUnifiedIhAcAuthority;
/** AUTH-003: IH/AC aus dem Plan entfernen (bewusst idle, kein klassischer Fallback). */
function clearIhAcAuthority(plan) {
    return applyUnifiedIhAcAuthority(plan, [], [], {
        dailyPlanRevision: plan.revision,
        unifiedPlanId: "unified-failed",
    });
}
exports.clearIhAcAuthority = clearIhAcAuthority;

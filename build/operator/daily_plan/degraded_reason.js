"use strict";
/**
 * D1: Konkrete Begründung für Daily Plan (degraded) — kein Verhaltenswechsel.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainDailyPlanDegradedDe = void 0;
/**
 * Kompakte Ursache(n) für Briefing, z. B.:
 * "thermal learning usable only via Newton estimate, 0 completed cooling cycles"
 */
function explainDailyPlanDegradedDe(contributions, flags) {
    const parts = [];
    const ihFlex = contributions?.find((c) => c.contributionId === "immersion_heater.flexible");
    const d = (ihFlex?.details ?? null);
    if (d && (ihFlex?.quality.status === "degraded" || d.thermalLearningStatus === "degraded")) {
        if (typeof d.thermalLearningDegradedCauseDe === "string" && d.thermalLearningDegradedCauseDe.trim()) {
            parts.push(d.thermalLearningDegradedCauseDe.trim());
        }
        else if (d.thermalLearningModel === "newton") {
            const samples = typeof d.thermalLearningSamples === "number" ? d.thermalLearningSamples : 0;
            parts.push(`thermal learning usable only via Newton estimate, ${samples} completed cooling cycles`);
        }
    }
    for (const c of contributions ?? []) {
        if (!c.enabled || c.quality.status !== "degraded")
            continue;
        if (c.contributionId.startsWith("immersion_heater."))
            continue;
        parts.push(`${c.contributionId} degraded`);
    }
    if (flags.hasMandatoryGap)
        parts.push("mandatory energy gap");
    if (flags.hasUnallocated)
        parts.push("unallocated flexible demand");
    if (flags.noPvSlots)
        parts.push("no PV surplus slots");
    if (parts.length === 0) {
        return "gaps or incomplete inputs";
    }
    return [...new Set(parts)].slice(0, 3).join("; ");
}
exports.explainDailyPlanDegradedDe = explainDailyPlanDegradedDe;

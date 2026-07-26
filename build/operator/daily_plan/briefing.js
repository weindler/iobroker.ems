"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOperatorBriefingDe = void 0;
const slots_1 = require("./slots");
/**
 * Roadmap Block 3.3: `operator.briefing_de` kommt ab hier aus Daily Plan + Allocation
 * (aktueller Slot), nicht mehr aus `formatBriefing()` des alten Realtime-Planners
 * (`src/planner/run.ts`). Einzige Quelle für Text-Inhalt ist damit derselbe Daily Plan,
 * den auch die Add-ons für ihre Steuerung lesen — keine zweite, abweichende Zusammenfassung.
 */
const DAILY_PLAN_BRIEFING_MAX_LEN = 480;
function currentSlot(plan, now, timezone) {
    const startIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    return plan.slots.find((s) => s.slot.startIso === startIso) ?? null;
}
function addonHighlightDe(entries, contributionPrefix, labelDe) {
    const active = entries.filter((e) => (e.contributionId === contributionPrefix || e.contributionId.startsWith(`${contributionPrefix}.`)) &&
        e.allocatedPowerW !== null &&
        e.allocatedPowerW > 0);
    if (active.length === 0)
        return null;
    const totalW = active.reduce((sum, e) => sum + (e.allocatedPowerW ?? 0), 0);
    const mandatoryActive = active.some((e) => e.mandatory);
    return `${labelDe} ${Math.round(totalW)} W${mandatoryActive ? " (Pflicht)" : ""}.`;
}
/** Baut die Operator-Briefing-Zeile aus dem Daily Plan des aktuellen Slots. */
function buildOperatorBriefingDe(plan, now, timezone) {
    if (!plan) {
        return "Daily Plan noch nicht initialisiert.";
    }
    const lines = [`Daily Plan (${plan.status}). Mode: ${plan.globalMode}.`];
    const slot = currentSlot(plan, now, timezone);
    if (!slot) {
        lines.push(plan.reasonDe || "Kein aktueller Daily-Plan-Slot gefunden.");
        return lines.join(" ").slice(0, DAILY_PLAN_BRIEFING_MAX_LEN);
    }
    lines.push(slot.reasonDe || plan.reasonDe);
    const highlights = [
        addonHighlightDe(slot.allocations, "immersion_heater", "Heizstab"),
        addonHighlightDe(slot.allocations, "battery", "Batterie"),
        addonHighlightDe(slot.allocations, "wallbox", "Wallbox"),
        addonHighlightDe(slot.allocations, "air_conditioning", "Klima"),
    ].filter((h) => h !== null);
    lines.push(...highlights);
    return lines.join(" ").slice(0, DAILY_PLAN_BRIEFING_MAX_LEN);
}
exports.buildOperatorBriefingDe = buildOperatorBriefingDe;

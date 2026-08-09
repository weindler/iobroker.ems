import type { PlanContribution } from "../types";
import type { DailyAllocationEntry, DailyPlan, DailyPlanSlot } from "./types";
import { slotStartIsoFloored } from "./slots";
import { explainDailyPlanDegradedDe } from "./degraded_reason";

/**
 * Roadmap Block 3.3: `operator.briefing_de` kommt ab hier aus Daily Plan + Allocation
 * (aktueller Slot), nicht mehr aus `formatBriefing()` des alten Realtime-Planners
 * (`src/planner/run.ts`). Einzige Quelle für Text-Inhalt ist damit derselbe Daily Plan,
 * den auch die Add-ons für ihre Steuerung lesen — keine zweite, abweichende Zusammenfassung.
 *
 * Klima ohne Zeitslots: Learning-/Forecast-Energiebedarf aus Contributions ergänzen
 * (sonst fehlt Klima komplett im Briefing, obwohl die Prognose läuft).
 */

const DAILY_PLAN_BRIEFING_MAX_LEN = 480;

function currentSlot(plan: DailyPlan, now: Date, timezone: string): DailyPlanSlot | null {
	const startIso = slotStartIsoFloored(now, timezone);
	return plan.slots.find((s) => s.slot.startIso === startIso) ?? null;
}

function addonHighlightDe(
	entries: DailyAllocationEntry[],
	contributionPrefix: string,
	labelDe: string,
): string | null {
	const active = entries.filter(
		(e) =>
			(e.contributionId === contributionPrefix || e.contributionId.startsWith(`${contributionPrefix}.`)) &&
			e.allocatedPowerW !== null &&
			e.allocatedPowerW > 0,
	);
	if (active.length === 0) return null;
	const totalW = active.reduce((sum, e) => sum + (e.allocatedPowerW ?? 0), 0);
	const mandatoryActive = active.some((e) => e.mandatory);
	return `${labelDe} ${Math.round(totalW)} W${mandatoryActive ? " (Pflicht)" : ""}.`;
}

function fmtHours(h: number): string {
	return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, "");
}

function fmtKwh(k: number): string {
	return k.toFixed(1).replace(/\.0$/, "");
}

/**
 * Klima plant keine 15-Min-Slots — Briefing zeigt trotzdem die Learning-/Forecast-Prognose.
 * Beispiel: „Klima laut Learning: Wohnzimmer EG ~2.8 h / 2.4 kWh; Josef …“
 */
export function climateLearningBriefingDe(contributions: PlanContribution[] | undefined): string | null {
	if (!contributions?.length) return null;
	const parts: string[] = [];
	for (const c of contributions) {
		if (!c.enabled || !c.contributionId.startsWith("air_conditioning.unit_")) continue;
		const d = c.details ?? {};
		if (d.likelyActive !== true) continue;
		const name =
			typeof d.unitName === "string" && d.unitName.trim()
				? d.unitName.trim()
				: c.contributionId.replace("air_conditioning.", "");
		const hours = typeof d.expectedHoursToday === "number" ? d.expectedHoursToday : null;
		const kwh = typeof d.expectedKwhToday === "number" ? d.expectedKwhToday : null;
		if (hours === null || kwh === null || hours <= 0) continue;
		parts.push(`${name} ~${fmtHours(hours)} h / ${fmtKwh(kwh)} kWh`);
	}
	if (parts.length === 0) return null;
	return `Klima laut Learning: ${parts.join("; ")}.`;
}

export type OperatorBriefingExtras = {
	/** Forecast-Contributions (für Klima-Energiebedarf ohne Slot-Allocation). */
	contributions?: PlanContribution[];
	/** Kurze KI-Denkspur (optional, aus ai.last_thinking_de). */
	aiThinkingDe?: string | null;
};

/** Baut die Operator-Briefing-Zeile aus dem Daily Plan des aktuellen Slots. */
export function buildOperatorBriefingDe(
	plan: DailyPlan | null,
	now: Date,
	timezone: string,
	extras?: OperatorBriefingExtras,
): string {
	if (!plan) {
		return "Daily Plan noch nicht initialisiert.";
	}

	let statusLabel: string = plan.status;
	if (plan.status === "degraded") {
		const cause = explainDailyPlanDegradedDe(extras?.contributions, {
			hasDegradedContributions: true,
		});
		statusLabel = `degraded: ${cause}`;
	}
	const lines: string[] = [`Daily Plan (${statusLabel}). Mode: ${plan.globalMode}.`];

	const slot = currentSlot(plan, now, timezone);
	if (!slot) {
		lines.push(plan.reasonDe || "Kein aktueller Daily-Plan-Slot gefunden.");
		const climateOnly = climateLearningBriefingDe(extras?.contributions);
		if (climateOnly) lines.push(climateOnly);
		return lines.join(" ").slice(0, DAILY_PLAN_BRIEFING_MAX_LEN);
	}

	lines.push(slot.reasonDe || plan.reasonDe);

	const highlights = [
		addonHighlightDe(slot.allocations, "immersion_heater", "Heizstab"),
		addonHighlightDe(slot.allocations, "battery", "Batterie"),
		addonHighlightDe(slot.allocations, "wallbox", "Wallbox"),
		addonHighlightDe(slot.allocations, "air_conditioning", "Klima"),
	].filter((h): h is string => h !== null);

	lines.push(...highlights);

	const climate = climateLearningBriefingDe(extras?.contributions);
	if (climate) lines.push(climate);

	const thinking = extras?.aiThinkingDe?.trim();
	if (thinking) {
		const short = thinking.length > 120 ? `${thinking.slice(0, 117)}…` : thinking;
		lines.push(`KI: ${short}`);
	}

	return lines.join(" ").slice(0, DAILY_PLAN_BRIEFING_MAX_LEN);
}

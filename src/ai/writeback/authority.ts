/**
 * Beta AI Authority Boundary (Schritt 7 Final Gate).
 *
 * Learning → Input → Unified Planner = autoritative Allocation.
 * AI erklärt / vergleicht / empfiehlt — mutiert keine Live-Slices.
 *
 * Plan-B-Simulation (`applyAiPreferencesToDailyPlan`) bleibt für Compare/Advisory erhalten,
 * wird aber nicht mehr still als Live-Authority angewendet.
 */

/** Live-Mutation von Daily-/Unified-Allocations durch AI — für Beta aus. */
export const AI_ALLOCATION_LIVE_MUTATION_ENABLED = false;

export type PlanBAdvisory = {
	schemaVersion: 1;
	purpose: "plan_b_advisory";
	/** Compare sagt Plan B wäre besser — ohne Live-Apply. */
	planBPreferred: boolean;
	activePlanLabel: "a" | "b";
	decisionReasonDe: string;
	deltaCostCt: number;
	/** Explizit: keine Allocation-/Slice-Mutation. */
	mutatesAllocations: false;
	mutatesLiveSlices: false;
};

export function buildPlanBAdvisory(compare: {
	delta: {
		activePlan: "a" | "b";
		decisionReasonDe: string;
		deltaCostCt: number;
	};
}): PlanBAdvisory {
	const preferred = compare.delta.activePlan === "b";
	const base = compare.delta.decisionReasonDe.replace(
		/Write-back auf Allocation wenn KI aktiv\.?/i,
		"advisory only — Unified bleibt autoritativ.",
	);
	const reason = preferred
		? `Plan B advisory (kein Live-Write-back): ${base}`.slice(0, 480)
		: base;
	return {
		schemaVersion: 1,
		purpose: "plan_b_advisory",
		planBPreferred: preferred,
		activePlanLabel: compare.delta.activePlan,
		decisionReasonDe: reason,
		deltaCostCt: compare.delta.deltaCostCt,
		mutatesAllocations: false,
		mutatesLiveSlices: false,
	};
}

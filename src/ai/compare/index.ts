import type { DailyPlan } from "../../operator/daily_plan/types";
import { ensureCompareStates } from "./ensure_states";
import { runPlanCompare, type CompareRunHost } from "./run";
import type { CompareResult } from "./types";

export { ensureCompareStates } from "./ensure_states";
export { COMPARE_STATES } from "./ensure_states";
export { buildCompareResult, COMPARE_ELIGIBLE_GOVERNED_IDS } from "./build";
export type { CompareResult, CompareDeltaSummary, ComparePlanPoint, ComparePlanTotals } from "./types";
export { runPlanCompare } from "./run";
export type { CompareRunHost } from "./run";

let lastComparedRevision = -1;

export function resetPlanCompareHookForTest(): void {
	lastComparedRevision = -1;
}

export async function ensureCompareStateTree(host: Parameters<typeof ensureCompareStates>[0]): Promise<void> {
	await ensureCompareStates(host);
}

/**
 * Aktualisiert den Plan-Vergleich nur bei tatsächlicher Daily-Plan-Änderung (neue Revision) —
 * analog zum KI-Hook, damit nicht bei jedem Tick unnötig geschrieben wird.
 */
export async function maybeUpdatePlanCompareOnDailyPlanChange(
	host: CompareRunHost,
	plan: DailyPlan,
): Promise<CompareResult | null> {
	if (plan.revision === lastComparedRevision) {
		return null;
	}
	lastComparedRevision = plan.revision;
	return runPlanCompare(host, plan);
}

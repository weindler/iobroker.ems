import type { DailyPlan } from "../../operator/daily_plan/types";
import { resolveAllowedAddonIds } from "../context";
import { AI_STATES } from "../ensure_states";
import type { AiSlotPreference } from "../types";
import { COMPARE_STATES } from "../compare/ensure_states";
import type { CompareResult } from "../compare/types";
import { applyAiPreferencesToDailyPlan } from "./apply_plan_b";
import { republishDailyPlanAfterWriteback, type WritebackPublishHost } from "./publish";

export type WritebackHost = WritebackPublishHost & {
	config: unknown;
};

async function readSlotPreferences(host: WritebackHost): Promise<AiSlotPreference[]> {
	try {
		const st = await host.getStateAsync(AI_STATES.lastSlotPreferencesJson);
		if (typeof st?.val !== "string" || !st.val) return [];
		const parsed = JSON.parse(st.val) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(p): p is AiSlotPreference =>
				!!p &&
				typeof p === "object" &&
				typeof (p as AiSlotPreference).addonId === "string" &&
				typeof (p as AiSlotPreference).slotStartIso === "string" &&
				typeof (p as AiSlotPreference).weight === "number",
		);
	} catch {
		return [];
	}
}

async function writeCompareStates(host: WritebackHost, result: CompareResult): Promise<void> {
	await host.setStateAsync(COMPARE_STATES.planAChartJson, { val: JSON.stringify(result.chartA), ack: true });
	await host.setStateAsync(COMPARE_STATES.planBChartJson, { val: JSON.stringify(result.chartB), ack: true });
	await host.setStateAsync(COMPARE_STATES.deltaSummaryJson, { val: JSON.stringify(result.delta), ack: true });
	await host.setStateAsync(COMPARE_STATES.activePlan, { val: result.delta.activePlan, ack: true });
	await host.setStateAsync(COMPARE_STATES.generatedAt, { val: result.generatedAt, ack: true });
	await host.setStateAsync(COMPARE_STATES.planRevision, { val: result.planRevision, ack: true });
}

export async function isAiAutoSuspended(host: WritebackHost): Promise<boolean> {
	const st = await host.getStateAsync(AI_STATES.autoSuspended);
	return st?.val === true;
}

export async function suspendAiAuto(host: WritebackHost, reasonDe: string): Promise<void> {
	await host.setStateAsync(AI_STATES.autoSuspended, { val: true, ack: true });
	await host.setStateAsync(AI_STATES.autoSuspendReasonDe, { val: reasonDe.slice(0, 480), ack: true });
	await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
}

export async function clearAiAutoSuspend(host: WritebackHost): Promise<void> {
	await host.setStateAsync(AI_STATES.autoSuspended, { val: false, ack: true });
	await host.setStateAsync(AI_STATES.autoSuspendReasonDe, { val: "", ack: true });
}

/**
 * Nach Daily-Plan-Build: vorhandene KI-Präferenzen auswerten — bei messbarem Plan-B-Vorteil
 * Allocation umschreiben (Write-back), sonst Plan A unverändert.
 */
export async function maybeApplyAiWritebackOnDailyPlan(
	host: WritebackHost,
	plan: DailyPlan,
): Promise<DailyPlan> {
	const prefs = await readSlotPreferences(host);
	if (prefs.length === 0) return plan;

	const allowed = resolveAllowedAddonIds(host.config);
	const { plan: next, compare, writebackApplied } = applyAiPreferencesToDailyPlan(plan, allowed, prefs);
	await writeCompareStates(host, compare);
	return writebackApplied ? next : plan;
}

/**
 * Nach einem KI-Lauf: Plan B prüfen — gewinnen → Suspend löschen + sofort publish;
 * verlieren → Auto-Trigger sperren und Präferenzen verwerfen.
 */
export async function finalizeAiRunWithWritebackGate(
	host: WritebackHost,
	plan: DailyPlan,
	slotPreferences: AiSlotPreference[],
): Promise<{ writebackApplied: boolean; suspended: boolean; compare: CompareResult }> {
	const allowed = resolveAllowedAddonIds(host.config);
	const { plan: next, compare, writebackApplied } = applyAiPreferencesToDailyPlan(
		plan,
		allowed,
		slotPreferences,
	);
	await writeCompareStates(host, compare);

	if (writebackApplied) {
		await clearAiAutoSuspend(host);
		await republishDailyPlanAfterWriteback(host, next);
		return { writebackApplied: true, suspended: false, compare };
	}

	if (slotPreferences.length > 0) {
		await suspendAiAuto(host, compare.delta.decisionReasonDe);
		return { writebackApplied: false, suspended: true, compare };
	}

	return { writebackApplied: false, suspended: false, compare };
}

export { applyAiPreferencesToDailyPlan } from "./apply_plan_b";
export { republishDailyPlanAfterWriteback } from "./publish";

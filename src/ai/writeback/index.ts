import type { DailyPlan } from "../../operator/daily_plan/types";
import { resolveAllowedAddonIds } from "../context";
import { AI_STATES } from "../ensure_states";
import { immersionDeferTomorrowFromDecisions, wallboxPvOnlyFromDecisions } from "../strategy_preferences";
import type { AiAddonDecision, AiSlotPreference } from "../types";
import { COMPARE_STATES } from "../compare/ensure_states";
import type { CompareResult } from "../compare/types";
import { applyAiPreferencesToDailyPlan, type ApplyAiPreferencesOptions } from "./apply_plan_b";
import {
	AI_ALLOCATION_LIVE_MUTATION_ENABLED,
	buildPlanBAdvisory,
	type PlanBAdvisory,
} from "./authority";
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

async function readDecisions(host: WritebackHost): Promise<AiAddonDecision[]> {
	try {
		const st = await host.getStateAsync(AI_STATES.lastDecisionsJson);
		if (typeof st?.val !== "string" || !st.val) return [];
		const parsed = JSON.parse(st.val) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(d): d is AiAddonDecision =>
				!!d &&
				typeof d === "object" &&
				typeof (d as AiAddonDecision).addonId === "string" &&
				typeof (d as AiAddonDecision).action === "string" &&
				typeof (d as AiAddonDecision).note === "string",
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
 * Nach Daily-Plan-Build: Plan-B-Compare schreiben (advisory).
 * Beta: Allocation wird nie mutiert — Unified bleibt alleinige Planwahrheit.
 */
export async function maybeApplyAiWritebackOnDailyPlan(
	host: WritebackHost,
	plan: DailyPlan,
): Promise<DailyPlan> {
	const prefs = await readSlotPreferences(host);
	if (prefs.length === 0) return plan;

	const decisions = await readDecisions(host);
	const options: ApplyAiPreferencesOptions = {
		wallboxPvOnly: wallboxPvOnlyFromDecisions(decisions),
		immersionDeferTomorrow: immersionDeferTomorrowFromDecisions(decisions),
	};
	const allowed = resolveAllowedAddonIds(host.config);
	const { plan: next, compare, writebackApplied } = applyAiPreferencesToDailyPlan(
		plan,
		allowed,
		prefs,
		options,
	);
	const advisory = buildPlanBAdvisory(compare);
	compare.delta.decisionReasonDe = advisory.decisionReasonDe;
	await writeCompareStates(host, compare);

	if (!AI_ALLOCATION_LIVE_MUTATION_ENABLED) {
		return plan;
	}
	return writebackApplied ? next : plan;
}

export type FinalizeWritebackOptions = ApplyAiPreferencesOptions & {
	/**
	 * Denkmodus: bei fehlendem Plan-B-Vorteil nicht auto-sperren (Denken bleibt nutzbar).
	 * Legacy: weiter suspendieren, damit teure Auto-Loops stoppen.
	 */
	skipAutoSuspend?: boolean;
};

export type FinalizeWritebackResult = {
	/** Live-Allocation-Mutation — Beta immer false. */
	writebackApplied: boolean;
	/** Compare bevorzugte Plan B (advisory). */
	planBPreferred: boolean;
	suspended: boolean;
	compare: CompareResult;
	advisory: PlanBAdvisory;
};

/**
 * Nach einem KI-Lauf: Plan B vergleichen — advisory Compare publizieren.
 * Beta: kein republish mutierter Allocations; Prefs bleiben als Empfehlung erhalten,
 * wenn Plan B bevorzugt wird (für spätere Unified-Replan-Inputs).
 */
export async function finalizeAiRunWithWritebackGate(
	host: WritebackHost,
	plan: DailyPlan,
	slotPreferences: AiSlotPreference[],
	options?: FinalizeWritebackOptions,
): Promise<FinalizeWritebackResult> {
	const allowed = resolveAllowedAddonIds(host.config);
	const { plan: next, compare, writebackApplied } = applyAiPreferencesToDailyPlan(
		plan,
		allowed,
		slotPreferences,
		options,
	);
	const advisory = buildPlanBAdvisory(compare);
	compare.delta.decisionReasonDe = advisory.decisionReasonDe;
	await writeCompareStates(host, compare);

	const planBPreferred = compare.delta.activePlan === "b";

	if (AI_ALLOCATION_LIVE_MUTATION_ENABLED && writebackApplied) {
		await clearAiAutoSuspend(host);
		await republishDailyPlanAfterWriteback(host, next);
		return {
			writebackApplied: true,
			planBPreferred: true,
			suspended: false,
			compare,
			advisory,
		};
	}

	if (planBPreferred) {
		// Advisory win: Prefs behalten (späterer Unified-Input), kein Live-Republish.
		await clearAiAutoSuspend(host);
		return {
			writebackApplied: false,
			planBPreferred: true,
			suspended: false,
			compare,
			advisory,
		};
	}

	// Verwaiste Prefs entfernen, damit Daily-Plan-Rebuild nicht stumpf re-appliziert.
	if (slotPreferences.length > 0) {
		await host.setStateAsync(AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
	}

	// Auto-suspend nur Legacy: Prefs da, kein Vorteil — nie nur wegen leerem Denken / Thinking-Modus.
	if (slotPreferences.length > 0 && options?.skipAutoSuspend !== true) {
		await suspendAiAuto(host, compare.delta.decisionReasonDe);
		return {
			writebackApplied: false,
			planBPreferred: false,
			suspended: true,
			compare,
			advisory,
		};
	}

	return {
		writebackApplied: false,
		planBPreferred: false,
		suspended: false,
		compare,
		advisory,
	};
}

export { applyAiPreferencesToDailyPlan } from "./apply_plan_b";
export { republishDailyPlanAfterWriteback } from "./publish";
export {
	AI_ALLOCATION_LIVE_MUTATION_ENABLED,
	buildPlanBAdvisory,
	type PlanBAdvisory,
} from "./authority";

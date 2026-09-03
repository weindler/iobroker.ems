import type { DailyPlan } from "../../operator/daily_plan/types";
import { resolveAllowedAddonIds } from "../context";
import { AI_STATES } from "../ensure_states";
import { immersionDeferTomorrowFromDecisions } from "../strategy_preferences";
import type { AiAddonDecision, AiSlotPreference } from "../types";
import { buildCompareResult } from "./build";
import { COMPARE_STATES } from "./ensure_states";
import type { CompareResult } from "./types";

export type CompareRunHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

async function readSlotPreferences(host: CompareRunHost): Promise<AiSlotPreference[]> {
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

async function readDecisions(host: CompareRunHost): Promise<AiAddonDecision[]> {
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

/**
 * Berechnet den Plan-Vergleich (Plan A vs. KI-gewichtete Plan-B-Simulation für Heizstab/Klima) und
 * schreibt die compare.*-States. Reine Beobachtung — ändert nie den tatsächlich ausgeführten Plan A.
 */
export async function runPlanCompare(host: CompareRunHost, plan: DailyPlan): Promise<CompareResult> {
	const allowedAddonIds = resolveAllowedAddonIds(host.config);
	const slotPreferences = await readSlotPreferences(host);
	const decisions = await readDecisions(host);
	const result = buildCompareResult(plan, allowedAddonIds, slotPreferences, {
		immersionDeferTomorrow: immersionDeferTomorrowFromDecisions(decisions),
	});

	await host.setStateAsync(COMPARE_STATES.planAChartJson, { val: JSON.stringify(result.chartA), ack: true });
	await host.setStateAsync(COMPARE_STATES.planBChartJson, { val: JSON.stringify(result.chartB), ack: true });
	await host.setStateAsync(COMPARE_STATES.deltaSummaryJson, { val: JSON.stringify(result.delta), ack: true });
	await host.setStateAsync(COMPARE_STATES.activePlan, { val: result.delta.activePlan, ack: true });
	await host.setStateAsync(COMPARE_STATES.generatedAt, { val: result.generatedAt, ack: true });
	await host.setStateAsync(COMPARE_STATES.planRevision, { val: result.planRevision, ack: true });

	return result;
}

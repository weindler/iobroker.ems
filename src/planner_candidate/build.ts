import { buildForecastPlan } from "../operator/forecast/build";
import { buildDailyPlanFromForecast } from "../operator/daily_plan/build";
import { plannerModePolicyFromGlobalMode } from "../planner/mode_policy";
import { preparePlannerFromSnapshot } from "../planner_preparation/prepare";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import { collectContributionsFromSnapshot } from "./from_snapshot";
import { buildPlanCandidateFromPlans, type PlannerPlanCandidate } from "./types";

/**
 * Pure end-to-end candidate build from snapshot.
 * Same core functions for in-process reference and worker:
 * prepare → contributions → forecast → daily → normalized candidate.
 */
export function buildPlanCandidateFromSnapshot(snapshot: PlannerInputSnapshot): {
	prepared: ReturnType<typeof preparePlannerFromSnapshot>;
	candidate: PlannerPlanCandidate;
} {
	const prepared = preparePlannerFromSnapshot(snapshot);
	const { now, timezone, contributions } = collectContributionsFromSnapshot(snapshot);
	const forecast = buildForecastPlan({ now, timezone, contributions });
	const modePolicy = plannerModePolicyFromGlobalMode(snapshot.general.globalMode);
	const daily = buildDailyPlanFromForecast(now, timezone, modePolicy.mode, forecast, {
		policySnapshot: {
			revision: snapshot.policy.revision,
			status: snapshot.policy.status,
			gridImportAllowed: snapshot.policy.gridImportAllowed,
			maxGridImportW: snapshot.policy.maxGridImportW,
			houseFuseLimitW: snapshot.policy.houseFuseLimitW,
		},
		energyPriority: snapshot.policy.energyPriority ?? [],
		mutualExclusions: snapshot.policy.mutualExclusions ?? [],
		gridImportAllowedPolicy: snapshot.policy.gridImportAllowed,
		effectiveMaxGridImportW: prepared.policy.effectiveMaxGridImportW,
		configuredHouseFuseLimitW: prepared.policy.configuredHouseFuseLimitW,
		modePolicy: {
			mode: modePolicy.mode,
			allowOptimization: modePolicy.allowOptimization,
		},
	});
	const candidate = buildPlanCandidateFromPlans({
		inputRevision: snapshot.inputRevision,
		preparationRevision: prepared.preparationRevision,
		capturedAt: snapshot.capturedAt,
		timezone,
		horizonStart: prepared.horizonStart || forecast.horizonStart,
		horizonEnd: prepared.horizonEnd || forecast.horizonEnd,
		forecast,
		daily,
		contributions,
	});
	return { prepared, candidate };
}

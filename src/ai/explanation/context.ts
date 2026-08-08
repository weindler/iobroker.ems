/**
 * Kompakter AI-Explanation-Context — kein voller Statebaum.
 * KI erklärt; sie plant nicht neu.
 */

import type { DeterministicDayExplanation } from "../../learning/day_evaluation/explain";
import type { DayEvaluationRecord } from "../../learning/day_evaluation/types";
import type { NotificationCandidate } from "../../learning/day_evaluation/notify";
import type { UnifiedDayPlan } from "../../operator/daily_plan/unified/types";
import { buildDeterministicDayExplanation } from "../../learning/day_evaluation/explain";

export type AiExplanationContext = {
	schemaVersion: 1;
	purpose: "explain_unified_day_plan";
	/** Harte Fakten — Validation prüft dagegen. */
	facts: DeterministicDayExplanation;
	dayEvaluation: DayEvaluationRecord | null;
	notificationCandidates: NotificationCandidate[];
	learningConfidence: {
		pvBiasTier: "none" | "few" | "usable" | "stale";
		thermalHeatFactorSamples: number;
		vehiclePresenceNote: string;
	};
	replan: {
		replanCount: number;
		replanReasons: string[];
		initialPlanId: string | null;
		finalPlanId: string | null;
	};
	/** Explizite Verbote für Prompt/Validation. */
	constraints: {
		aiMustNotPlan: true;
		aiMustNotWriteDevices: true;
		aiMustNotInventSavings: true;
		aiMustNotClaimGoalSafeWhenAtRisk: true;
		dischargeLiveUnsupported: true;
		evccIsWallboxMaster: true;
	};
};

export function buildAiExplanationContext(input: {
	plan: UnifiedDayPlan;
	batteryStartSocPct?: number | null;
	dayEvaluation?: DayEvaluationRecord | null;
	notificationCandidates?: NotificationCandidate[];
	replanCount?: number;
	replanReasons?: string[];
	initialPlanId?: string | null;
	pvBiasSampleDays?: number;
	thermalHeatFactorSamples?: number;
}): AiExplanationContext {
	const facts = buildDeterministicDayExplanation(input.plan, {
		batteryStartSocPct: input.batteryStartSocPct,
	});
	const pvDays = input.pvBiasSampleDays ?? 0;
	const pvTier =
		pvDays <= 0 ? "none" : pvDays < 3 ? "few" : ("usable" as const);
	return {
		schemaVersion: 1,
		purpose: "explain_unified_day_plan",
		facts,
		dayEvaluation: input.dayEvaluation ?? null,
		notificationCandidates: input.notificationCandidates ?? [],
		learningConfidence: {
			pvBiasTier: pvTier,
			thermalHeatFactorSamples: input.thermalHeatFactorSamples ?? 0,
			vehiclePresenceNote: "vehicle_presence learning remains authority (step 5)",
		},
		replan: {
			replanCount: input.replanCount ?? 0,
			replanReasons: input.replanReasons ?? [],
			initialPlanId: input.initialPlanId ?? null,
			finalPlanId: input.plan.planId,
		},
		constraints: {
			aiMustNotPlan: true,
			aiMustNotWriteDevices: true,
			aiMustNotInventSavings: true,
			aiMustNotClaimGoalSafeWhenAtRisk: true,
			dischargeLiveUnsupported: true,
			evccIsWallboxMaster: true,
		},
	};
}

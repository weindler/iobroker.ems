"use strict";
/**
 * Kompakter AI-Explanation-Context — kein voller Statebaum.
 * KI erklärt; sie plant nicht neu.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiExplanationContext = void 0;
const explain_1 = require("../../learning/day_evaluation/explain");
function buildAiExplanationContext(input) {
    const facts = (0, explain_1.buildDeterministicDayExplanation)(input.plan, {
        batteryStartSocPct: input.batteryStartSocPct,
    });
    const pvDays = input.pvBiasSampleDays ?? 0;
    const pvTier = pvDays <= 0 ? "none" : pvDays < 3 ? "few" : "usable";
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
exports.buildAiExplanationContext = buildAiExplanationContext;

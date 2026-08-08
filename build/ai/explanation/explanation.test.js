"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("../../operator/daily_plan/unified/allocate");
const alloc_fixtures_1 = require("../../operator/daily_plan/unified/alloc_fixtures");
const context_1 = require("./context");
const validate_1 = require("./validate");
(0, node_test_1.describe)("AI-EXPLAIN-001 context matches unified plan", () => {
    (0, node_test_1.it)("facts planId and PV match", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const ctx = (0, context_1.buildAiExplanationContext)({ plan });
        strict_1.default.equal(ctx.facts.planId, plan.planId);
        strict_1.default.equal(ctx.facts.heute.pvExpectedKwh, plan.expectedPvEnergyTodayKwh);
        strict_1.default.equal(ctx.facts.fahrzeug.savingsCt, plan.vehicleChargeEconomics?.savingsVsAlternativeCt ?? null);
        strict_1.default.equal(ctx.constraints.aiMustNotPlan, true);
        strict_1.default.equal(ctx.constraints.dischargeLiveUnsupported, true);
        strict_1.default.equal(ctx.constraints.evccIsWallboxMaster, true);
    });
});
(0, node_test_1.describe)("AI-EXPLAIN-002 at_risk must not claim safe goal", () => {
    (0, node_test_1.it)("rejects safe-goal language", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const risky = {
            ...plan,
            goalStatuses: [
                {
                    consumerId: "wallbox",
                    goalId: "energy_deadline",
                    met: null,
                    detailDe: "at risk",
                },
            ],
        };
        const ctx = (0, context_1.buildAiExplanationContext)({ plan: risky });
        const bad = (0, validate_1.validateExplanationAgainstFacts)(ctx, "Das Fahrzeugziel ist sicher erreichbar bis zur Deadline.");
        strict_1.default.equal(bad.ok, false);
        strict_1.default.ok(bad.issues.some((i) => i.code === "goal_safety_hallucination"));
    });
});
(0, node_test_1.describe)("AI-EXPLAIN-003 savings null → no invented savings", () => {
    (0, node_test_1.it)("flags invented savings claims", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const patched = {
            ...plan,
            vehicleChargeEconomics: plan.vehicleChargeEconomics
                ? {
                    ...plan.vehicleChargeEconomics,
                    savingsVsAlternativeCt: null,
                    economicsCompleteness: "unknown",
                }
                : null,
        };
        const ctx = (0, context_1.buildAiExplanationContext)({ plan: patched });
        ctx.facts.fahrzeug.savingsCt = null;
        const bad = (0, validate_1.validateExplanationAgainstFacts)(ctx, "Du sparst dadurch 1,35 € gegenüber sofortigem Laden.");
        strict_1.default.equal(bad.ok, false);
        strict_1.default.ok(bad.issues.some((i) => i.code === "invented_savings"));
    });
});
(0, node_test_1.describe)("AI-EXPLAIN-004 SOC unknown uncertainty", () => {
    (0, node_test_1.it)("flags certain SOC language when risk notes unknown", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const ctx = (0, context_1.buildAiExplanationContext)({ plan });
        ctx.facts.risiken.push("vehicle_soc_unknown");
        const bad = (0, validate_1.validateExplanationAgainstFacts)(ctx, "Der SOC beträgt exakt 55 % und ist zuverlässig.");
        strict_1.default.equal(bad.ok, false);
    });
});
(0, node_test_1.describe)("AI-EXPLAIN-005 AI unavailable → ok", () => {
    (0, node_test_1.it)("null explanation validates as ok (planner unaffected)", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const ctx = (0, context_1.buildAiExplanationContext)({ plan });
        strict_1.default.equal((0, validate_1.validateExplanationAgainstFacts)(ctx, null).ok, true);
        strict_1.default.equal((0, validate_1.validateExplanationAgainstFacts)(ctx, "").ok, true);
    });
});

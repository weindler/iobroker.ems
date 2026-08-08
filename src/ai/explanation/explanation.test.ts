import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "../../operator/daily_plan/unified/allocate";
import { alloc003Input, alloc004Input } from "../../operator/daily_plan/unified/alloc_fixtures";
import { buildAiExplanationContext } from "./context";
import { validateExplanationAgainstFacts } from "./validate";

describe("AI-EXPLAIN-001 context matches unified plan", () => {
	it("facts planId and PV match", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const ctx = buildAiExplanationContext({ plan });
		assert.equal(ctx.facts.planId, plan.planId);
		assert.equal(ctx.facts.heute.pvExpectedKwh, plan.expectedPvEnergyTodayKwh);
		assert.equal(ctx.facts.fahrzeug.savingsCt, plan.vehicleChargeEconomics?.savingsVsAlternativeCt ?? null);
		assert.equal(ctx.constraints.aiMustNotPlan, true);
		assert.equal(ctx.constraints.dischargeLiveUnsupported, true);
		assert.equal(ctx.constraints.evccIsWallboxMaster, true);
	});
});

describe("AI-EXPLAIN-002 at_risk must not claim safe goal", () => {
	it("rejects safe-goal language", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const risky = {
			...plan,
			goalStatuses: [
				{
					consumerId: "wallbox",
					goalId: "energy_deadline",
					met: null as boolean | null,
					detailDe: "at risk",
				},
			],
		};
		const ctx = buildAiExplanationContext({ plan: risky });
		const bad = validateExplanationAgainstFacts(
			ctx,
			"Das Fahrzeugziel ist sicher erreichbar bis zur Deadline.",
		);
		assert.equal(bad.ok, false);
		assert.ok(bad.issues.some((i) => i.code === "goal_safety_hallucination"));
	});
});

describe("AI-EXPLAIN-003 savings null → no invented savings", () => {
	it("flags invented savings claims", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const patched = {
			...plan,
			vehicleChargeEconomics: plan.vehicleChargeEconomics
				? {
						...plan.vehicleChargeEconomics,
						savingsVsAlternativeCt: null,
						economicsCompleteness: "unknown" as const,
					}
				: null,
		};
		const ctx = buildAiExplanationContext({ plan: patched });
		ctx.facts.fahrzeug.savingsCt = null;
		const bad = validateExplanationAgainstFacts(
			ctx,
			"Du sparst dadurch 1,35 € gegenüber sofortigem Laden.",
		);
		assert.equal(bad.ok, false);
		assert.ok(bad.issues.some((i) => i.code === "invented_savings"));
	});
});

describe("AI-EXPLAIN-004 SOC unknown uncertainty", () => {
	it("flags certain SOC language when risk notes unknown", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const ctx = buildAiExplanationContext({ plan });
		ctx.facts.risiken.push("vehicle_soc_unknown");
		const bad = validateExplanationAgainstFacts(
			ctx,
			"Der SOC beträgt exakt 55 % und ist zuverlässig.",
		);
		assert.equal(bad.ok, false);
	});
});

describe("AI-EXPLAIN-005 AI unavailable → ok", () => {
	it("null explanation validates as ok (planner unaffected)", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const ctx = buildAiExplanationContext({ plan });
		assert.equal(validateExplanationAgainstFacts(ctx, null).ok, true);
		assert.equal(validateExplanationAgainstFacts(ctx, "").ok, true);
	});
});

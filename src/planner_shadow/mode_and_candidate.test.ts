import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEffectivePlannerMode, initialSessionShadowFromNative } from "./mode.js";
import { PHASE_3E_PUBLISH_DEFAULTS, resolvePlannerPublishTarget } from "../planner_publish/policy.js";
import { buildPlanCandidateFromSnapshot } from "../planner_candidate/build.js";
import { comparePlanCandidates } from "./candidate_compare.js";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";

describe("planner_shadow mode resolution", () => {
	it("persisted shadow_enabled cannot activate when native is off", () => {
		const effective = resolveEffectivePlannerMode({
			config: { planner_runtime_mode: "off" },
			sessionShadowEnabled: true,
		});
		assert.equal(effective.effectiveMode, "off");
		assert.equal(effective.coordinatorEnabled, false);
	});

	it("native shadow_manual arms session initially", () => {
		assert.equal(initialSessionShadowFromNative("shadow_manual"), true);
		assert.equal(initialSessionShadowFromNative("off"), false);
		const effective = resolveEffectivePlannerMode({
			config: { planner_runtime_mode: "shadow_manual" },
			sessionShadowEnabled: true,
		});
		assert.equal(effective.effectiveMode, "shadow_manual");
		assert.equal(effective.allowsAuto, false);
		assert.equal(effective.allowsManual, true);
	});

	it("session disable pauses native shadow without changing config", () => {
		const effective = resolveEffectivePlannerMode({
			config: { planner_runtime_mode: "shadow_auto" },
			sessionShadowEnabled: false,
		});
		assert.equal(effective.configuredMode, "shadow_auto");
		assert.equal(effective.effectiveMode, "off");
	});
});

describe("planner_publish gate", () => {
	it("blocks canonical even in shadow_auto simulation", () => {
		const decision = resolvePlannerPublishTarget({
			requestedTarget: "canonical",
			jobMode: "simulation",
			releaseGate: PHASE_3E_PUBLISH_DEFAULTS.releaseGate,
			candidateValid: true,
			generationMatches: true,
			inputRevisionMatches: true,
			shuttingDown: false,
			productiveTakeoverMode: PHASE_3E_PUBLISH_DEFAULTS.productiveTakeoverMode,
		});
		assert.equal(decision.allowed, false);
		assert.equal(decision.target, "blocked_canonical");
	});

	it("allows candidate target", () => {
		const decision = resolvePlannerPublishTarget({
			requestedTarget: "candidate",
			jobMode: "simulation",
			releaseGate: "closed",
			candidateValid: true,
			generationMatches: true,
			inputRevisionMatches: true,
			shuttingDown: false,
			productiveTakeoverMode: false,
		});
		assert.equal(decision.allowed, true);
		assert.equal(decision.target, "candidate");
	});
});

describe("planner_shadow candidate compare", () => {
	it("identical candidates match", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const a = buildPlanCandidateFromSnapshot(snapshot).candidate;
		const b = buildPlanCandidateFromSnapshot(snapshot).candidate;
		const result = comparePlanCandidates(a, b);
		assert.equal(result.status, "matched");
		assert.equal(result.mismatchCount, 0);
	});

	it("slot deviation yields mismatch with domain", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const reference = buildPlanCandidateFromSnapshot(snapshot).candidate;
		const worker = structuredClone(reference);
		if (worker.forecastSlots[0]) {
			worker.forecastSlots[0].pvPowerW = (worker.forecastSlots[0].pvPowerW ?? 0) + 99;
		}
		const result = comparePlanCandidates(reference, worker);
		assert.equal(result.status, "mismatch");
		assert.ok((result.mismatchedSlotCount ?? 0) >= 1);
		assert.equal(result.firstMismatchDomain, "forecast");
	});

	it("does not put large payloads in result", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const a = buildPlanCandidateFromSnapshot(snapshot).candidate;
		const result = comparePlanCandidates(a, a);
		assert.ok(!("forecastSlots" in result));
		assert.ok(!("allocations" in result));
	});
});

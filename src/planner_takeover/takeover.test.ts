import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerTakeoverEvaluationMode,
	plannerTakeoverEvaluationModeFromConfig,
	PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT,
} from "../planner_config/evaluation_mode.js";
import { resolveEffectiveTakeoverEvaluation, correlateDualRuns } from "./correlation.js";
import {
	applyDualRunToEvidence,
	emptyTakeoverEvidence,
	policyFingerprint,
	reconcileLoadedEvidence,
	sealEvidence,
} from "./evidence.js";
import { resolvePlannerTakeoverDecision } from "./decision.js";
import { tryMintCanonicalPublishPermitFromShadow } from "../planner_publish/permit.js";
import { PHASE_3F_PUBLISH_DEFAULTS, resolvePlannerPublishTarget } from "../planner_publish/policy.js";
import {
	canonicalizePowerW,
	canonicalizeUtcIso,
	numbersSemanticallyEqual,
} from "./canonize.js";
import { projectCandidateToNormalizedPlan } from "./project.js";
import { compareNormalizedPlans } from "./compare.js";
import { DEFAULT_TAKEOVER_READINESS_POLICY, type TakeoverReadinessPolicy } from "./constants.js";
import type { PlannerDualRunIdentity } from "./types.js";
import type { PlannerPlanCandidate } from "../planner_candidate/types.js";
import { retainPlannerCandidates } from "./retention.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

function baseIdentity(over: Partial<PlannerDualRunIdentity> = {}): PlannerDualRunIdentity {
	return {
		dualRunId: "dual-1",
		generation: 1,
		triggerClass: "schedule",
		triggerReason: "scheduled",
		inputRevision: "a".repeat(64),
		snapshotSchemaVersion: 1,
		planningHorizonStart: "2026-07-17T10:00:00Z",
		planningHorizonEnd: "2026-07-18T10:00:00Z",
		slotDurationMinutes: 15,
		force: false,
		...over,
	};
}

function tinyPolicy(over: Partial<TakeoverReadinessPolicy> = {}): TakeoverReadinessPolicy {
	return {
		...DEFAULT_TAKEOVER_READINESS_POLICY,
		minEligibleRuns: 3,
		minConsecutiveMatches: 3,
		minObservationMs: 1_000,
		minDistinctUtcDays: 2,
		maxMismatches: 0,
		maxFailures: 0,
		maxStaleEligibleMs: 60_000,
		requireSlotTransition: true,
		requireDayTransition: true,
		...over,
	};
}

function minimalCandidate(over: Partial<PlannerPlanCandidate> = {}): PlannerPlanCandidate {
	return {
		schemaVersion: 1,
		inputRevision: "a".repeat(64),
		preparationRevision: "b".repeat(64),
		candidateRevision: "c".repeat(64),
		generatedAt: "2026-07-17T10:00:00.123Z",
		capturedAt: "2026-07-17T10:00:00.123Z",
		timezone: "UTC",
		horizonStart: "2026-07-17T10:00:00.000Z",
		horizonEnd: "2026-07-18T10:00:00.000Z",
		slotCount: 1,
		forecastStatus: "ready",
		dailyStatus: "ready",
		validationStatus: "ok",
		qualityCodes: [],
		contributions: [],
		forecastSlots: [
			{
				start: "2026-07-17T10:00:00.000Z",
				end: "2026-07-17T10:15:00.000Z",
				pvPowerW: 1000.4,
				houseLoadPowerW: 200,
				fixedBalancePowerW: 0,
				gridPriceCtPerKwh: 12.34567,
				gridImportAllowed: true,
				gridMaxImportPowerW: 5000,
			},
		],
		allocations: [
			{
				contributionId: "battery",
				slotStart: "2026-07-17T10:00:00.000Z",
				slotEnd: "2026-07-17T10:15:00.000Z",
				powerW: 100,
				energyKwh: 0.025,
				status: "allocated",
			},
		],
		totals: {
			flexibleAllocatedEnergyKwh: 0.025,
			flexibleUnallocatedEnergyKwh: 0,
			pvForecastEnergyKwh: 0.25,
			fixedHouseLoadEnergyKwh: 0.05,
		},
		...over,
	};
}

describe("planner_takeover evaluation mode", () => {
	it("defaults to disabled", () => {
		assert.equal(PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, "disabled");
		assert.equal(parsePlannerTakeoverEvaluationMode(undefined).mode, "disabled");
		assert.equal(plannerTakeoverEvaluationModeFromConfig({}).mode, "disabled");
	});

	it("clamps invalid values", () => {
		const parsed = parsePlannerTakeoverEvaluationMode("takeover_now");
		assert.equal(parsed.mode, "disabled");
		assert.equal(parsed.clamped, true);
	});

	it("observe only effective with shadow_auto", () => {
		assert.equal(
			resolveEffectiveTakeoverEvaluation({
				plannerRuntimeMode: "shadow_manual",
				configuredEvaluationMode: "observe",
			}).observing,
			false,
		);
		assert.equal(
			resolveEffectiveTakeoverEvaluation({
				plannerRuntimeMode: "shadow_auto",
				configuredEvaluationMode: "observe",
			}).observing,
			true,
		);
		assert.equal(
			resolveEffectiveTakeoverEvaluation({
				plannerRuntimeMode: "shadow_auto",
				configuredEvaluationMode: "disabled",
			}).observing,
			false,
		);
	});
});

describe("planner_takeover correlation", () => {
	it("matching identity is comparable", () => {
		const id = baseIdentity();
		assert.equal(correlateDualRuns({ authoritative: id, candidate: id }).status, "comparable");
	});

	it("generation mismatch is not_comparable", () => {
		const a = baseIdentity();
		const c = baseIdentity({ generation: 2 });
		const r = correlateDualRuns({ authoritative: a, candidate: c });
		assert.equal(r.status, "not_comparable");
		assert.equal(r.reason, "generation_mismatch");
	});

	it("horizon mismatch is not_comparable", () => {
		const a = baseIdentity();
		const c = baseIdentity({ planningHorizonStart: "2026-07-17T11:00:00Z" });
		assert.equal(correlateDualRuns({ authoritative: a, candidate: c }).status, "not_comparable");
	});

	it("slot duration mismatch is not_comparable", () => {
		const a = baseIdentity();
		const c = baseIdentity({ slotDurationMinutes: 30 });
		assert.equal(correlateDualRuns({ authoritative: a, candidate: c }).status, "not_comparable");
	});
});

describe("planner_takeover canonize and compare", () => {
	it("UTC canonization strips millis", () => {
		assert.equal(canonicalizeUtcIso("2026-07-17T10:00:00.999Z"), "2026-07-17T10:00:00Z");
	});

	it("power rounds to watts", () => {
		assert.equal(canonicalizePowerW(1000.4), 1000);
		assert.equal(numbersSemanticallyEqual(1000, 1000, "power_w"), true);
	});

	it("presentation-only differences still match after projection", () => {
		const a = projectCandidateToNormalizedPlan(minimalCandidate());
		const b = projectCandidateToNormalizedPlan(
			minimalCandidate({
				generatedAt: "2099-01-01T00:00:00Z",
				candidateRevision: "different",
				forecastSlots: [
					{
						...minimalCandidate().forecastSlots[0]!,
						pvPowerW: 1000.4, // same after round
					},
				],
			}),
		);
		assert.equal(compareNormalizedPlans(a, b).status, "matched");
	});

	it("power deviation is mismatch", () => {
		const a = projectCandidateToNormalizedPlan(minimalCandidate());
		const other = minimalCandidate();
		other.forecastSlots[0]!.pvPowerW = 1500;
		const b = projectCandidateToNormalizedPlan(other);
		const r = compareNormalizedPlans(a, b);
		assert.equal(r.status, "mismatch");
		assert.equal(r.firstMismatchDomain, "forecast");
	});

	it("slot bound deviation is mismatch", () => {
		const a = projectCandidateToNormalizedPlan(minimalCandidate());
		const other = minimalCandidate();
		other.forecastSlots[0]!.start = "2026-07-17T10:01:00.000Z";
		other.forecastSlots[0]!.end = "2026-07-17T10:16:00.000Z";
		const b = projectCandidateToNormalizedPlan(other);
		assert.equal(compareNormalizedPlans(a, b).status, "mismatch");
	});
});

describe("planner_takeover authoritative projection once", () => {
	it("computes exactly once and compare reuses the same object", async () => {
		const { buildPlannerInputSnapshot } = await import("../planner_snapshot/builder.js");
		const { createParityFixtureSource } = await import("../planner_snapshot/parity_fixture.js");
		const {
			computeAuthoritativeDualRunProjection,
			getActiveAuthoritativeProjection,
			getAuthoritativeComputeCountForTest,
			resetAuthoritativeProjectionCountersForTest,
			clearActiveAuthoritativeProjection,
		} = await import("./authoritative_projection.js");
		const { comparePlanCandidates } = await import("../planner_shadow/candidate_compare.js");

		resetAuthoritativeProjectionCountersForTest();
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const auth = computeAuthoritativeDualRunProjection({
			snapshot,
			generation: 7,
			jobId: "planner-7-test",
			sealPublish: () => true,
		});
		assert.equal(getAuthoritativeComputeCountForTest(), 1);
		assert.equal(getActiveAuthoritativeProjection()?.candidate, auth.candidate);

		// Simulate worker candidate that matches — without recomputing authoritative.
		const worker = structuredClone(auth.candidate);
		const cmp = comparePlanCandidates(auth.candidate, worker);
		assert.equal(cmp.status, "matched");
		assert.equal(getAuthoritativeComputeCountForTest(), 1);
		assert.equal(getActiveAuthoritativeProjection()?.generation, 7);
		assert.equal(getActiveAuthoritativeProjection()?.inputRevision, snapshot.inputRevision);
		clearActiveAuthoritativeProjection();
	});

	it("authoritative≠worker yields mismatch and blocks readiness", async () => {
		const { buildPlannerInputSnapshot } = await import("../planner_snapshot/builder.js");
		const { createParityFixtureSource } = await import("../planner_snapshot/parity_fixture.js");
		const {
			computeAuthoritativeDualRunProjection,
			getAuthoritativeComputeCountForTest,
			resetAuthoritativeProjectionCountersForTest,
			clearActiveAuthoritativeProjection,
		} = await import("./authoritative_projection.js");

		resetAuthoritativeProjectionCountersForTest();
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const auth = computeAuthoritativeDualRunProjection({
			snapshot,
			generation: 3,
			jobId: "planner-3-test",
		});
		const worker = structuredClone(auth.candidate);
		if (worker.forecastSlots[0]) {
			worker.forecastSlots[0].pvPowerW = (worker.forecastSlots[0].pvPowerW ?? 0) + 250;
		}
		const authNorm = projectCandidateToNormalizedPlan(auth.candidate);
		const workNorm = projectCandidateToNormalizedPlan(worker);
		const cmp = compareNormalizedPlans(authNorm, workNorm);
		assert.equal(cmp.status, "mismatch");
		assert.equal(getAuthoritativeComputeCountForTest(), 1);

		const policy = tinyPolicy({
			requireSlotTransition: false,
			requireDayTransition: false,
			minDistinctUtcDays: 1,
			minEligibleRuns: 1,
			minConsecutiveMatches: 1,
			minObservationMs: 1,
		});
		const e = applyDualRunToEvidence(emptyTakeoverEvidence(policy), {
			nowIso: "2026-07-17T10:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({
				generation: 3,
				inputRevision: auth.candidate.inputRevision,
				planningHorizonStart: auth.candidate.horizonStart,
				planningHorizonEnd: auth.candidate.horizonEnd,
			}),
			compareStatus: "mismatch",
			firstMismatchDomain: cmp.firstMismatchDomain,
			authoritativeRevision: authNorm.semanticRevision,
			candidateRevision: workNorm.semanticRevision,
			policy,
		});
		assert.equal(e.state, "blocked");
		assert.notEqual(e.state, "ready");
		assert.equal(e.lastBlockReason, "semantic_mismatch");
		clearActiveAuthoritativeProjection();
	});

	it("failed authoritative publish seal is authoritative_failed and not a positive match", async () => {
		const { buildPlannerInputSnapshot } = await import("../planner_snapshot/builder.js");
		const { createParityFixtureSource } = await import("../planner_snapshot/parity_fixture.js");
		const {
			computeAuthoritativeDualRunProjection,
			authoritativeProjectionIsUsable,
			resetAuthoritativeProjectionCountersForTest,
			clearActiveAuthoritativeProjection,
		} = await import("./authoritative_projection.js");

		resetAuthoritativeProjectionCountersForTest();
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const projection = computeAuthoritativeDualRunProjection({
			snapshot,
			generation: 9,
			jobId: "planner-9-test",
			sealPublish: () => false,
		});
		assert.equal(projection.publishStatus, "failed");
		assert.equal(authoritativeProjectionIsUsable(projection), false);

		const policy = tinyPolicy({
			requireSlotTransition: false,
			requireDayTransition: false,
			minDistinctUtcDays: 1,
			minEligibleRuns: 1,
			minConsecutiveMatches: 1,
		});
		const e = applyDualRunToEvidence(emptyTakeoverEvidence(policy), {
			nowIso: "2026-07-17T10:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({ generation: 9, inputRevision: snapshot.inputRevision }),
			compareStatus: "authoritative_failed",
			errorCode: "authoritative_publish_failed",
			policy,
		});
		assert.equal(e.state, "blocked");
		assert.equal(e.matchedRuns, 0);
		assert.ok(e.failedRuns >= 1);
		assert.notEqual(e.state, "ready");
		clearActiveAuthoritativeProjection();
	});
});

describe("planner_takeover evidence", () => {
	it("disabled observation collects nothing durable", () => {
		const e = applyDualRunToEvidence(null, {
			nowIso: "2026-07-17T10:00:00Z",
			observing: false,
			shuttingDown: false,
			identity: baseIdentity(),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
		});
		assert.equal(e.state, "not_evaluated");
		assert.equal(e.eligibleRuns, 0);
	});

	it("force run is diagnostic only", () => {
		const e = applyDualRunToEvidence(emptyTakeoverEvidence(tinyPolicy()), {
			nowIso: "2026-07-17T10:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({ force: true }),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
			policy: tinyPolicy(),
			diagnosticOnly: true,
		});
		assert.equal(e.eligibleRuns, 0);
		assert.equal(e.matchedRuns, 0);
	});

	it("match increases counters; mismatch resets consecutive and blocks", () => {
		const policy = tinyPolicy({ requireSlotTransition: false, requireDayTransition: false, minDistinctUtcDays: 1 });
		let e = emptyTakeoverEvidence(policy);
		e = applyDualRunToEvidence(e, {
			nowIso: "2026-07-17T10:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity(),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
			policy,
		});
		assert.equal(e.matchedRuns, 1);
		assert.equal(e.consecutiveMatches, 1);
		e = applyDualRunToEvidence(e, {
			nowIso: "2026-07-17T10:15:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({ planningHorizonStart: "2026-07-17T10:15:00Z" }),
			compareStatus: "mismatch",
			firstMismatchDomain: "forecast",
			authoritativeRevision: "a",
			candidateRevision: "c",
			policy,
		});
		assert.equal(e.state, "blocked");
		assert.equal(e.consecutiveMatches, 0);
		assert.equal(e.lastBlockReason, "semantic_mismatch");
		// subsequent single match does not clear block without full series
		e = applyDualRunToEvidence(e, {
			nowIso: "2026-07-17T10:30:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({ planningHorizonStart: "2026-07-17T10:30:00Z" }),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
			policy,
		});
		assert.notEqual(e.state, "ready");
		assert.equal(e.consecutiveMatches, 1);
	});

	it("ready only after all criteria", () => {
		const policy = tinyPolicy({
			minEligibleRuns: 2,
			minConsecutiveMatches: 2,
			minObservationMs: 10,
			minDistinctUtcDays: 2,
			requireSlotTransition: true,
			requireDayTransition: true,
			maxStaleEligibleMs: 86_400_000,
		});
		let e = sealEvidence({
			...emptyTakeoverEvidence(policy),
			state: "collecting",
			observationStartedAt: "2026-07-16T10:00:00Z",
			policyFingerprint: policyFingerprint(policy),
			lastBlockReason: null,
		});
		e = applyDualRunToEvidence(e, {
			nowIso: "2026-07-16T12:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({
				planningHorizonStart: "2026-07-16T12:00:00Z",
				planningHorizonEnd: "2026-07-17T12:00:00Z",
			}),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
			policy,
		});
		e = applyDualRunToEvidence(e, {
			nowIso: "2026-07-17T12:00:00Z",
			observing: true,
			shuttingDown: false,
			identity: baseIdentity({
				planningHorizonStart: "2026-07-17T12:00:00Z",
				planningHorizonEnd: "2026-07-18T12:00:00Z",
			}),
			compareStatus: "matched",
			authoritativeRevision: "a",
			candidateRevision: "b",
			policy,
		});
		assert.equal(e.state, "ready");
		assert.ok(e.observedSlotTransitions >= 1);
		assert.ok(e.observedDayTransitions >= 1);
		assert.ok(e.observedDistinctUtcDays >= 2);
	});

	it("shutdown abort does not add positive evidence", () => {
		const policy = tinyPolicy();
		const prev = sealEvidence({
			...emptyTakeoverEvidence(policy),
			state: "collecting",
			eligibleRuns: 5,
			matchedRuns: 5,
			consecutiveMatches: 5,
			policyFingerprint: policyFingerprint(policy),
			observationStartedAt: "2026-07-17T00:00:00Z",
			lastBlockReason: null,
		});
		const e = applyDualRunToEvidence(prev, {
			nowIso: "2026-07-17T10:00:00Z",
			observing: true,
			shuttingDown: true,
			identity: baseIdentity(),
			compareStatus: "aborted",
			policy,
		});
		assert.equal(e.eligibleRuns, 5);
		assert.equal(e.matchedRuns, 5);
		assert.notEqual(e.state, "ready");
	});

	it("policy change resets evidence", () => {
		const a = tinyPolicy({ minEligibleRuns: 3 });
		const b = tinyPolicy({ minEligibleRuns: 5 });
		const loaded = reconcileLoadedEvidence(
			sealEvidence({
				...emptyTakeoverEvidence(a),
				state: "ready",
				eligibleRuns: 99,
				policyFingerprint: policyFingerprint(a),
				lastBlockReason: null,
			}),
			b,
		);
		assert.equal(loaded.resetReason, "policy_reset");
		assert.equal(loaded.evidence.eligibleRuns, 0);
		assert.notEqual(loaded.evidence.state, "ready");
	});
});

describe("planner_takeover decision and permit", () => {
	it("ready still forbids canonical", () => {
		const decision = resolvePlannerTakeoverDecision({
			requestedTarget: "canonical",
			evaluationState: "ready",
			inputRevision: "a",
			candidateRevision: "b",
			authoritativeRevision: "c",
		});
		assert.equal(decision.canonicalAllowed, false);
		assert.notEqual(decision.resolvedTarget, "canonical" as string);
		assert.ok(decision.blockReasons.includes("canonical_gate_closed"));
	});

	it("no shadow input mints a permit", () => {
		assert.equal(
			tryMintCanonicalPublishPermitFromShadow({
				evaluationState: "ready",
				requestedTarget: "canonical",
				productiveTakeoverMode: true,
				evidence: { state: "ready" },
				workerResult: { status: "ok" },
				config: { planner_takeover_evaluation_mode: "observe" },
			}),
			null,
		);
	});

	it("publish policy remains blocked in phase 3f", () => {
		const d = resolvePlannerPublishTarget({
			requestedTarget: "canonical",
			jobMode: "publish",
			releaseGate: PHASE_3F_PUBLISH_DEFAULTS.releaseGate,
			candidateValid: true,
			generationMatches: true,
			inputRevisionMatches: true,
			shuttingDown: false,
			productiveTakeoverMode: true,
		});
		assert.equal(d.allowed, false);
		assert.equal(d.target, "blocked_canonical");
	});
});

describe("planner_takeover retention", () => {
	it("never deletes protected dirs; respects age/count; ignores canonical", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "ems-cand-"));
		const canonical = path.join(root, "..", "canonical-should-not-touch");
		await fs.mkdir(canonical, { recursive: true });
		await fs.writeFile(path.join(canonical, "forecast_plan_v1.json"), "{}");
		for (const name of ["job-old", "job-new", "job-active"]) {
			const d = path.join(root, name);
			await fs.mkdir(d);
			await fs.writeFile(path.join(d, "plan_candidate_v1.json"), "{\"x\":1}");
		}
		const old = path.join(root, "job-old");
		const ancient = Date.now() - 10 * 24 * 60 * 60 * 1000;
		await fs.utimes(old, ancient / 1000, ancient / 1000);

		const result = await retainPlannerCandidates({
			candidateRootDir: root,
			protectedJobIds: ["job-active"],
			maxRecent: 1,
			maxAgeMs: 24 * 60 * 60 * 1000,
			nowMs: Date.now(),
		});
		assert.ok(result.kept.includes("job-active"));
		assert.ok(!(await exists(old)) || result.deleted.includes("job-old"));
		assert.ok(await exists(path.join(canonical, "forecast_plan_v1.json")));
		await fs.rm(root, { recursive: true, force: true });
	});
});

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

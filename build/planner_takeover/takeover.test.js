"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evaluation_mode_js_1 = require("../planner_config/evaluation_mode.js");
const correlation_js_1 = require("./correlation.js");
const evidence_js_1 = require("./evidence.js");
const decision_js_1 = require("./decision.js");
const permit_js_1 = require("../planner_publish/permit.js");
const policy_js_1 = require("../planner_publish/policy.js");
const canonize_js_1 = require("./canonize.js");
const project_js_1 = require("./project.js");
const compare_js_1 = require("./compare.js");
const constants_js_1 = require("./constants.js");
const retention_js_1 = require("./retention.js");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function baseIdentity(over = {}) {
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
function tinyPolicy(over = {}) {
    return {
        ...constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY,
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
function minimalCandidate(over = {}) {
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
(0, node_test_1.describe)("planner_takeover evaluation mode", () => {
    (0, node_test_1.it)("defaults to disabled", () => {
        strict_1.default.equal(evaluation_mode_js_1.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, "disabled");
        strict_1.default.equal((0, evaluation_mode_js_1.parsePlannerTakeoverEvaluationMode)(undefined).mode, "disabled");
        strict_1.default.equal((0, evaluation_mode_js_1.plannerTakeoverEvaluationModeFromConfig)({}).mode, "disabled");
    });
    (0, node_test_1.it)("clamps invalid values", () => {
        const parsed = (0, evaluation_mode_js_1.parsePlannerTakeoverEvaluationMode)("takeover_now");
        strict_1.default.equal(parsed.mode, "disabled");
        strict_1.default.equal(parsed.clamped, true);
    });
    (0, node_test_1.it)("observe only effective with shadow_auto", () => {
        strict_1.default.equal((0, correlation_js_1.resolveEffectiveTakeoverEvaluation)({
            plannerRuntimeMode: "shadow_manual",
            configuredEvaluationMode: "observe",
        }).observing, false);
        strict_1.default.equal((0, correlation_js_1.resolveEffectiveTakeoverEvaluation)({
            plannerRuntimeMode: "shadow_auto",
            configuredEvaluationMode: "observe",
        }).observing, true);
        strict_1.default.equal((0, correlation_js_1.resolveEffectiveTakeoverEvaluation)({
            plannerRuntimeMode: "shadow_auto",
            configuredEvaluationMode: "disabled",
        }).observing, false);
    });
});
(0, node_test_1.describe)("planner_takeover correlation", () => {
    (0, node_test_1.it)("matching identity is comparable", () => {
        const id = baseIdentity();
        strict_1.default.equal((0, correlation_js_1.correlateDualRuns)({ authoritative: id, candidate: id }).status, "comparable");
    });
    (0, node_test_1.it)("generation mismatch is not_comparable", () => {
        const a = baseIdentity();
        const c = baseIdentity({ generation: 2 });
        const r = (0, correlation_js_1.correlateDualRuns)({ authoritative: a, candidate: c });
        strict_1.default.equal(r.status, "not_comparable");
        strict_1.default.equal(r.reason, "generation_mismatch");
    });
    (0, node_test_1.it)("horizon mismatch is not_comparable", () => {
        const a = baseIdentity();
        const c = baseIdentity({ planningHorizonStart: "2026-07-17T11:00:00Z" });
        strict_1.default.equal((0, correlation_js_1.correlateDualRuns)({ authoritative: a, candidate: c }).status, "not_comparable");
    });
    (0, node_test_1.it)("slot duration mismatch is not_comparable", () => {
        const a = baseIdentity();
        const c = baseIdentity({ slotDurationMinutes: 30 });
        strict_1.default.equal((0, correlation_js_1.correlateDualRuns)({ authoritative: a, candidate: c }).status, "not_comparable");
    });
});
(0, node_test_1.describe)("planner_takeover canonize and compare", () => {
    (0, node_test_1.it)("UTC canonization strips millis", () => {
        strict_1.default.equal((0, canonize_js_1.canonicalizeUtcIso)("2026-07-17T10:00:00.999Z"), "2026-07-17T10:00:00Z");
    });
    (0, node_test_1.it)("power rounds to watts", () => {
        strict_1.default.equal((0, canonize_js_1.canonicalizePowerW)(1000.4), 1000);
        strict_1.default.equal((0, canonize_js_1.numbersSemanticallyEqual)(1000, 1000, "power_w"), true);
    });
    (0, node_test_1.it)("presentation-only differences still match after projection", () => {
        const a = (0, project_js_1.projectCandidateToNormalizedPlan)(minimalCandidate());
        const b = (0, project_js_1.projectCandidateToNormalizedPlan)(minimalCandidate({
            generatedAt: "2099-01-01T00:00:00Z",
            candidateRevision: "different",
            forecastSlots: [
                {
                    ...minimalCandidate().forecastSlots[0],
                    pvPowerW: 1000.4, // same after round
                },
            ],
        }));
        strict_1.default.equal((0, compare_js_1.compareNormalizedPlans)(a, b).status, "matched");
    });
    (0, node_test_1.it)("power deviation is mismatch", () => {
        const a = (0, project_js_1.projectCandidateToNormalizedPlan)(minimalCandidate());
        const other = minimalCandidate();
        other.forecastSlots[0].pvPowerW = 1500;
        const b = (0, project_js_1.projectCandidateToNormalizedPlan)(other);
        const r = (0, compare_js_1.compareNormalizedPlans)(a, b);
        strict_1.default.equal(r.status, "mismatch");
        strict_1.default.equal(r.firstMismatchDomain, "forecast");
    });
    (0, node_test_1.it)("slot bound deviation is mismatch", () => {
        const a = (0, project_js_1.projectCandidateToNormalizedPlan)(minimalCandidate());
        const other = minimalCandidate();
        other.forecastSlots[0].start = "2026-07-17T10:01:00.000Z";
        other.forecastSlots[0].end = "2026-07-17T10:16:00.000Z";
        const b = (0, project_js_1.projectCandidateToNormalizedPlan)(other);
        strict_1.default.equal((0, compare_js_1.compareNormalizedPlans)(a, b).status, "mismatch");
    });
});
(0, node_test_1.describe)("planner_takeover authoritative projection once", () => {
    (0, node_test_1.it)("computes exactly once and compare reuses the same object", async () => {
        const { buildPlannerInputSnapshot } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/builder.js")));
        const { createParityFixtureSource } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/parity_fixture.js")));
        const { computeAuthoritativeDualRunProjection, getActiveAuthoritativeProjection, getAuthoritativeComputeCountForTest, resetAuthoritativeProjectionCountersForTest, clearActiveAuthoritativeProjection, } = await Promise.resolve().then(() => __importStar(require("./authoritative_projection.js")));
        const { comparePlanCandidates } = await Promise.resolve().then(() => __importStar(require("../planner_shadow/candidate_compare.js")));
        resetAuthoritativeProjectionCountersForTest();
        const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
        const auth = computeAuthoritativeDualRunProjection({
            snapshot,
            generation: 7,
            jobId: "planner-7-test",
            sealPublish: () => true,
        });
        strict_1.default.equal(getAuthoritativeComputeCountForTest(), 1);
        strict_1.default.equal(getActiveAuthoritativeProjection()?.candidate, auth.candidate);
        // Simulate worker candidate that matches — without recomputing authoritative.
        const worker = structuredClone(auth.candidate);
        const cmp = comparePlanCandidates(auth.candidate, worker);
        strict_1.default.equal(cmp.status, "matched");
        strict_1.default.equal(getAuthoritativeComputeCountForTest(), 1);
        strict_1.default.equal(getActiveAuthoritativeProjection()?.generation, 7);
        strict_1.default.equal(getActiveAuthoritativeProjection()?.inputRevision, snapshot.inputRevision);
        clearActiveAuthoritativeProjection();
    });
    (0, node_test_1.it)("authoritative≠worker yields mismatch and blocks readiness", async () => {
        const { buildPlannerInputSnapshot } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/builder.js")));
        const { createParityFixtureSource } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/parity_fixture.js")));
        const { computeAuthoritativeDualRunProjection, getAuthoritativeComputeCountForTest, resetAuthoritativeProjectionCountersForTest, clearActiveAuthoritativeProjection, } = await Promise.resolve().then(() => __importStar(require("./authoritative_projection.js")));
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
        const authNorm = (0, project_js_1.projectCandidateToNormalizedPlan)(auth.candidate);
        const workNorm = (0, project_js_1.projectCandidateToNormalizedPlan)(worker);
        const cmp = (0, compare_js_1.compareNormalizedPlans)(authNorm, workNorm);
        strict_1.default.equal(cmp.status, "mismatch");
        strict_1.default.equal(getAuthoritativeComputeCountForTest(), 1);
        const policy = tinyPolicy({
            requireSlotTransition: false,
            requireDayTransition: false,
            minDistinctUtcDays: 1,
            minEligibleRuns: 1,
            minConsecutiveMatches: 1,
            minObservationMs: 1,
        });
        const e = (0, evidence_js_1.applyDualRunToEvidence)((0, evidence_js_1.emptyTakeoverEvidence)(policy), {
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
        strict_1.default.equal(e.state, "blocked");
        strict_1.default.notEqual(e.state, "ready");
        strict_1.default.equal(e.lastBlockReason, "semantic_mismatch");
        clearActiveAuthoritativeProjection();
    });
    (0, node_test_1.it)("failed authoritative publish seal is authoritative_failed and not a positive match", async () => {
        const { buildPlannerInputSnapshot } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/builder.js")));
        const { createParityFixtureSource } = await Promise.resolve().then(() => __importStar(require("../planner_snapshot/parity_fixture.js")));
        const { computeAuthoritativeDualRunProjection, authoritativeProjectionIsUsable, resetAuthoritativeProjectionCountersForTest, clearActiveAuthoritativeProjection, } = await Promise.resolve().then(() => __importStar(require("./authoritative_projection.js")));
        resetAuthoritativeProjectionCountersForTest();
        const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
        const projection = computeAuthoritativeDualRunProjection({
            snapshot,
            generation: 9,
            jobId: "planner-9-test",
            sealPublish: () => false,
        });
        strict_1.default.equal(projection.publishStatus, "failed");
        strict_1.default.equal(authoritativeProjectionIsUsable(projection), false);
        const policy = tinyPolicy({
            requireSlotTransition: false,
            requireDayTransition: false,
            minDistinctUtcDays: 1,
            minEligibleRuns: 1,
            minConsecutiveMatches: 1,
        });
        const e = (0, evidence_js_1.applyDualRunToEvidence)((0, evidence_js_1.emptyTakeoverEvidence)(policy), {
            nowIso: "2026-07-17T10:00:00Z",
            observing: true,
            shuttingDown: false,
            identity: baseIdentity({ generation: 9, inputRevision: snapshot.inputRevision }),
            compareStatus: "authoritative_failed",
            errorCode: "authoritative_publish_failed",
            policy,
        });
        strict_1.default.equal(e.state, "blocked");
        strict_1.default.equal(e.matchedRuns, 0);
        strict_1.default.ok(e.failedRuns >= 1);
        strict_1.default.notEqual(e.state, "ready");
        clearActiveAuthoritativeProjection();
    });
});
(0, node_test_1.describe)("planner_takeover evidence", () => {
    (0, node_test_1.it)("disabled observation collects nothing durable", () => {
        const e = (0, evidence_js_1.applyDualRunToEvidence)(null, {
            nowIso: "2026-07-17T10:00:00Z",
            observing: false,
            shuttingDown: false,
            identity: baseIdentity(),
            compareStatus: "matched",
            authoritativeRevision: "a",
            candidateRevision: "b",
        });
        strict_1.default.equal(e.state, "not_evaluated");
        strict_1.default.equal(e.eligibleRuns, 0);
    });
    (0, node_test_1.it)("force run is diagnostic only", () => {
        const e = (0, evidence_js_1.applyDualRunToEvidence)((0, evidence_js_1.emptyTakeoverEvidence)(tinyPolicy()), {
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
        strict_1.default.equal(e.eligibleRuns, 0);
        strict_1.default.equal(e.matchedRuns, 0);
    });
    (0, node_test_1.it)("match increases counters; mismatch resets consecutive and blocks", () => {
        const policy = tinyPolicy({ requireSlotTransition: false, requireDayTransition: false, minDistinctUtcDays: 1 });
        let e = (0, evidence_js_1.emptyTakeoverEvidence)(policy);
        e = (0, evidence_js_1.applyDualRunToEvidence)(e, {
            nowIso: "2026-07-17T10:00:00Z",
            observing: true,
            shuttingDown: false,
            identity: baseIdentity(),
            compareStatus: "matched",
            authoritativeRevision: "a",
            candidateRevision: "b",
            policy,
        });
        strict_1.default.equal(e.matchedRuns, 1);
        strict_1.default.equal(e.consecutiveMatches, 1);
        e = (0, evidence_js_1.applyDualRunToEvidence)(e, {
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
        strict_1.default.equal(e.state, "blocked");
        strict_1.default.equal(e.consecutiveMatches, 0);
        strict_1.default.equal(e.lastBlockReason, "semantic_mismatch");
        // subsequent single match does not clear block without full series
        e = (0, evidence_js_1.applyDualRunToEvidence)(e, {
            nowIso: "2026-07-17T10:30:00Z",
            observing: true,
            shuttingDown: false,
            identity: baseIdentity({ planningHorizonStart: "2026-07-17T10:30:00Z" }),
            compareStatus: "matched",
            authoritativeRevision: "a",
            candidateRevision: "b",
            policy,
        });
        strict_1.default.notEqual(e.state, "ready");
        strict_1.default.equal(e.consecutiveMatches, 1);
    });
    (0, node_test_1.it)("ready only after all criteria", () => {
        const policy = tinyPolicy({
            minEligibleRuns: 2,
            minConsecutiveMatches: 2,
            minObservationMs: 10,
            minDistinctUtcDays: 2,
            requireSlotTransition: true,
            requireDayTransition: true,
            maxStaleEligibleMs: 86_400_000,
        });
        let e = (0, evidence_js_1.sealEvidence)({
            ...(0, evidence_js_1.emptyTakeoverEvidence)(policy),
            state: "collecting",
            observationStartedAt: "2026-07-16T10:00:00Z",
            policyFingerprint: (0, evidence_js_1.policyFingerprint)(policy),
            lastBlockReason: null,
        });
        e = (0, evidence_js_1.applyDualRunToEvidence)(e, {
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
        e = (0, evidence_js_1.applyDualRunToEvidence)(e, {
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
        strict_1.default.equal(e.state, "ready");
        strict_1.default.ok(e.observedSlotTransitions >= 1);
        strict_1.default.ok(e.observedDayTransitions >= 1);
        strict_1.default.ok(e.observedDistinctUtcDays >= 2);
    });
    (0, node_test_1.it)("shutdown abort does not add positive evidence", () => {
        const policy = tinyPolicy();
        const prev = (0, evidence_js_1.sealEvidence)({
            ...(0, evidence_js_1.emptyTakeoverEvidence)(policy),
            state: "collecting",
            eligibleRuns: 5,
            matchedRuns: 5,
            consecutiveMatches: 5,
            policyFingerprint: (0, evidence_js_1.policyFingerprint)(policy),
            observationStartedAt: "2026-07-17T00:00:00Z",
            lastBlockReason: null,
        });
        const e = (0, evidence_js_1.applyDualRunToEvidence)(prev, {
            nowIso: "2026-07-17T10:00:00Z",
            observing: true,
            shuttingDown: true,
            identity: baseIdentity(),
            compareStatus: "aborted",
            policy,
        });
        strict_1.default.equal(e.eligibleRuns, 5);
        strict_1.default.equal(e.matchedRuns, 5);
        strict_1.default.notEqual(e.state, "ready");
    });
    (0, node_test_1.it)("policy change resets evidence", () => {
        const a = tinyPolicy({ minEligibleRuns: 3 });
        const b = tinyPolicy({ minEligibleRuns: 5 });
        const loaded = (0, evidence_js_1.reconcileLoadedEvidence)((0, evidence_js_1.sealEvidence)({
            ...(0, evidence_js_1.emptyTakeoverEvidence)(a),
            state: "ready",
            eligibleRuns: 99,
            policyFingerprint: (0, evidence_js_1.policyFingerprint)(a),
            lastBlockReason: null,
        }), b);
        strict_1.default.equal(loaded.resetReason, "policy_reset");
        strict_1.default.equal(loaded.evidence.eligibleRuns, 0);
        strict_1.default.notEqual(loaded.evidence.state, "ready");
    });
});
(0, node_test_1.describe)("planner_takeover decision and permit", () => {
    (0, node_test_1.it)("ready still forbids canonical", () => {
        const decision = (0, decision_js_1.resolvePlannerTakeoverDecision)({
            requestedTarget: "canonical",
            evaluationState: "ready",
            inputRevision: "a",
            candidateRevision: "b",
            authoritativeRevision: "c",
        });
        strict_1.default.equal(decision.canonicalAllowed, false);
        strict_1.default.notEqual(decision.resolvedTarget, "canonical");
        strict_1.default.ok(decision.blockReasons.includes("canonical_gate_closed"));
    });
    (0, node_test_1.it)("no shadow input mints a permit", () => {
        strict_1.default.equal((0, permit_js_1.tryMintCanonicalPublishPermitFromShadow)({
            evaluationState: "ready",
            requestedTarget: "canonical",
            productiveTakeoverMode: true,
            evidence: { state: "ready" },
            workerResult: { status: "ok" },
            config: { planner_takeover_evaluation_mode: "observe" },
        }), null);
    });
    (0, node_test_1.it)("publish policy remains blocked in phase 3f", () => {
        const d = (0, policy_js_1.resolvePlannerPublishTarget)({
            requestedTarget: "canonical",
            jobMode: "publish",
            releaseGate: policy_js_1.PHASE_3F_PUBLISH_DEFAULTS.releaseGate,
            candidateValid: true,
            generationMatches: true,
            inputRevisionMatches: true,
            shuttingDown: false,
            productiveTakeoverMode: true,
        });
        strict_1.default.equal(d.allowed, false);
        strict_1.default.equal(d.target, "blocked_canonical");
    });
});
(0, node_test_1.describe)("planner_takeover retention", () => {
    (0, node_test_1.it)("never deletes protected dirs; respects age/count; ignores canonical", async () => {
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
        const result = await (0, retention_js_1.retainPlannerCandidates)({
            candidateRootDir: root,
            protectedJobIds: ["job-active"],
            maxRecent: 1,
            maxAgeMs: 24 * 60 * 60 * 1000,
            nowMs: Date.now(),
        });
        strict_1.default.ok(result.kept.includes("job-active"));
        strict_1.default.ok(!(await exists(old)) || result.deleted.includes("job-old"));
        strict_1.default.ok(await exists(path.join(canonical, "forecast_plan_v1.json")));
        await fs.rm(root, { recursive: true, force: true });
    });
});
async function exists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}

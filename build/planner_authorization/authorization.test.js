"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const authorization_mode_js_1 = require("../planner_config/authorization_mode.js");
const state_machine_js_1 = require("./state_machine.js");
const eligibility_js_1 = require("./eligibility.js");
const challenge_js_1 = require("./challenge.js");
const grant_js_1 = require("./grant.js");
const activation_js_1 = require("./activation.js");
const permit_preview_js_1 = require("./permit_preview.js");
const permit_js_1 = require("../planner_publish/permit.js");
const replay_js_1 = require("./replay.js");
const mutex_js_1 = require("./mutex.js");
const audit_io_js_1 = require("./audit_io.js");
const service_js_1 = require("./service.js");
const evidence_js_1 = require("../planner_takeover/evidence.js");
const constants_js_1 = require("../planner_takeover/constants.js");
const catalog_js_1 = require("../planner_trigger/catalog.js");
function readyEvidence() {
    return (0, evidence_js_1.sealEvidence)({
        ...(0, evidence_js_1.emptyTakeoverEvidence)(constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY),
        state: "ready",
        eligibleRuns: 100,
        matchedRuns: 100,
        consecutiveMatches: 100,
        observationStartedAt: "2026-07-16T00:00:00Z",
        lastEligibleRunAt: new Date().toISOString(),
        lastMatchAt: new Date().toISOString(),
        lastBlockReason: null,
        policyFingerprint: (0, evidence_js_1.policyFingerprint)(constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY),
        lastAuthoritativeRevision: "a".repeat(64),
        lastCandidateRevision: "b".repeat(64),
        observedDistinctUtcDays: 2,
        observedSlotTransitions: 2,
        observedDayTransitions: 1,
    });
}
function baseElig(over = {}) {
    return (0, eligibility_js_1.evaluateAuthorizationEligibility)({
        nowMs: Date.now(),
        adapterReady: true,
        shuttingDown: false,
        restoreBarrierActive: false,
        operationLockActive: false,
        plannerRuntimeMode: "shadow_auto",
        evaluationMode: "observe",
        authorizationMode: "manual_prepare",
        evidence: readyEvidence(),
        expectedEvidenceSchemaVersion: constants_js_1.TAKEOVER_EVIDENCE_SCHEMA_VERSION,
        expectedPolicyFingerprint: (0, evidence_js_1.policyFingerprint)(constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY),
        lastCompareStatus: "matched",
        authoritativeRevision: "a".repeat(64),
        candidateRevision: "b".repeat(64),
        inputRevision: "c".repeat(64),
        generationMatches: true,
        horizonMatches: true,
        candidateValid: true,
        authoritativePublishOk: true,
        plannerJobActive: false,
        pendingRerun: false,
        executionMode: "dryrun",
        challengeActive: false,
        grantActive: false,
        releaseGateClosed: true,
        ...over,
    });
}
function bound() {
    return {
        generation: 1,
        inputRevision: "c".repeat(64),
        candidateRevision: "b".repeat(64),
        authoritativeRevision: "a".repeat(64),
        evidenceRevision: readyEvidence().evidenceRevision,
        evidencePolicyRevision: (0, evidence_js_1.policyFingerprint)(constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY),
        planningHorizonStart: "2026-07-17T10:00:00Z",
        planningHorizonEnd: "2026-07-18T10:00:00Z",
        slotDurationMinutes: 15,
        plannerContractVersion: 1,
        snapshotSchemaVersion: 1,
        publishPolicyRevision: "phase_3g_closed",
    };
}
(0, node_test_1.describe)("planner_authorization config", () => {
    (0, node_test_1.it)("defaults to disabled", () => {
        strict_1.default.equal(authorization_mode_js_1.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, "disabled");
        strict_1.default.equal((0, authorization_mode_js_1.parsePlannerTakeoverAuthorizationMode)(undefined).mode, "disabled");
    });
    (0, node_test_1.it)("clamps invalid values", () => {
        const p = (0, authorization_mode_js_1.parsePlannerTakeoverAuthorizationMode)("auto_takeover");
        strict_1.default.equal(p.mode, "disabled");
        strict_1.default.equal(p.clamped, true);
    });
});
(0, node_test_1.describe)("planner_authorization state machine", () => {
    (0, node_test_1.it)("allows prepared → confirmed → activation_blocked", () => {
        strict_1.default.equal((0, state_machine_js_1.transitionAuthorizationState)("prepared", "confirmed"), "confirmed");
        strict_1.default.equal((0, state_machine_js_1.transitionAuthorizationState)("confirmed", "activation_blocked"), "activation_blocked");
    });
    (0, node_test_1.it)("rejects idle → confirmed", () => {
        strict_1.default.equal((0, state_machine_js_1.canTransitionAuthorizationState)("idle", "confirmed"), false);
        strict_1.default.throws(() => (0, state_machine_js_1.transitionAuthorizationState)("idle", "confirmed"));
    });
});
(0, node_test_1.describe)("planner_authorization eligibility", () => {
    (0, node_test_1.it)("full factors allow prepare", () => {
        strict_1.default.equal(baseElig().eligible, true);
    });
    (0, node_test_1.it)("evidence not ready blocks", () => {
        strict_1.default.ok(baseElig({ evidence: null }).codes.includes("evidence_not_ready"));
    });
    (0, node_test_1.it)("live execution mode blocks", () => {
        strict_1.default.ok(baseElig({ executionMode: "live" }).codes.includes("execution_mode_not_dryrun"));
    });
    (0, node_test_1.it)("publish seal failed blocks", () => {
        strict_1.default.ok(baseElig({ authoritativePublishOk: false }).codes.includes("authoritative_publish_failed"));
    });
    (0, node_test_1.it)("mismatch blocks", () => {
        strict_1.default.ok(baseElig({ lastCompareStatus: "mismatch" }).codes.includes("newer_mismatch"));
    });
    (0, node_test_1.it)("inclusive OR readiness: full=false pilot=false blocks", () => {
        const r = baseElig({ evidence: null, dryrunPilotReady: false });
        strict_1.default.equal(r.takeoverReady, false);
        strict_1.default.equal(r.fullEvidenceReady, false);
        strict_1.default.equal(r.dryrunPilotReady, false);
        strict_1.default.ok(r.codes.includes("evidence_not_ready"));
    });
    (0, node_test_1.it)("inclusive OR readiness: full=false pilot=true allows evidence gate", () => {
        const r = baseElig({
            evidence: { ...readyEvidence(), state: "collecting" },
            dryrunPilotReady: true,
        });
        strict_1.default.equal(r.takeoverReady, true);
        strict_1.default.equal(r.fullEvidenceReady, false);
        strict_1.default.equal(r.dryrunPilotReady, true);
        strict_1.default.equal(r.codes.includes("evidence_not_ready"), false);
    });
    (0, node_test_1.it)("inclusive OR readiness: full=true pilot=false allows evidence gate", () => {
        const r = baseElig({ dryrunPilotReady: false });
        strict_1.default.equal(r.takeoverReady, true);
        strict_1.default.equal(r.fullEvidenceReady, true);
        strict_1.default.equal(r.dryrunPilotReady, false);
        strict_1.default.equal(r.codes.includes("evidence_not_ready"), false);
    });
    (0, node_test_1.it)("inclusive OR readiness: full=true pilot=true allows (not XOR)", () => {
        const r = baseElig({ dryrunPilotReady: true });
        strict_1.default.equal(r.takeoverReady, true);
        strict_1.default.equal(r.fullEvidenceReady, true);
        strict_1.default.equal(r.dryrunPilotReady, true);
        strict_1.default.equal(r.codes.includes("evidence_not_ready"), false);
    });
});
(0, node_test_1.describe)("planner_authorization challenge grant permit", () => {
    (0, node_test_1.it)("prepare→confirm yields activation_blocked without permit", async () => {
        let evidence = readyEvidence();
        const b = bound();
        b.evidenceRevision = evidence.evidenceRevision;
        const service = new service_js_1.PlannerAuthorizationService({
            now: () => new Date("2026-07-17T12:00:00Z"),
            adapterInstance: "ems.0",
            sessionId: "session-1",
            auditDir: null,
            idFactory: () => "fixed-challenge-id",
            getRuntimeMode: () => "shadow_auto",
            getEvaluationMode: () => "observe",
            getAuthorizationMode: () => "manual_prepare",
            getEvidence: () => evidence,
            getEligibilityExtras: () => ({
                lastCompareStatus: "matched",
                authoritativeRevision: b.authoritativeRevision,
                candidateRevision: b.candidateRevision,
                inputRevision: b.inputRevision,
                generationMatches: true,
                horizonMatches: true,
                candidateValid: true,
                authoritativePublishOk: true,
                executionMode: "dryrun",
                bound: b,
            }),
        });
        await service.syncFromConfig();
        const prep = await service.prepare();
        strict_1.default.equal(prep.ok, true);
        strict_1.default.equal(service.getPublicStatus().state, "prepared");
        strict_1.default.equal(service.getPublicStatus().challengeId, "fixed-challenge-id");
        const conf = await service.confirm("fixed-challenge-id");
        strict_1.default.equal(conf.ok, true);
        strict_1.default.equal(conf.code, "activation_blocked");
        const status = service.getPublicStatus();
        strict_1.default.equal(status.state, "activation_blocked");
        strict_1.default.equal(status.grantActive, true);
        strict_1.default.equal(status.activationCapabilityPresent, false);
        strict_1.default.equal(status.permitMinted, false);
        strict_1.default.equal(status.canonicalAllowed, false);
        const preview = service.previewPermitMint();
        strict_1.default.equal(preview.permitMinted, false);
        strict_1.default.equal(preview.canonicalAllowed, false);
        strict_1.default.equal(preview.productiveActivationCapabilityPresent, false);
        strict_1.default.equal(preview.authorizationState, "activation_blocked");
        strict_1.default.ok(preview.primaryBlockReason === "activation_capability_missing" || preview.blockReasonCount >= 1);
        strict_1.default.equal((0, permit_js_1.tryMintCanonicalPublishPermitFromShadow)({ authorizationGrant: true }), null);
        strict_1.default.equal((0, activation_js_1.tryMintProductiveActivationCapability)({ grantPresent: true }), null);
        strict_1.default.equal((0, permit_preview_js_1.tryMintCanonicalPublishPermitWithGrant)({ grant: null, nowMs: Date.now() }), null);
        // replay rejected
        const again = await service.confirm("fixed-challenge-id");
        strict_1.default.equal(again.ok, false);
    });
    (0, node_test_1.it)("wrong confirm id increments failures then invalidates", async () => {
        const evidence = readyEvidence();
        const b = bound();
        b.evidenceRevision = evidence.evidenceRevision;
        let n = 0;
        const service = new service_js_1.PlannerAuthorizationService({
            now: () => new Date("2026-07-17T12:00:00Z"),
            adapterInstance: "ems.0",
            sessionId: "session-1",
            auditDir: null,
            idFactory: () => `id-${++n}`,
            getRuntimeMode: () => "shadow_auto",
            getEvaluationMode: () => "observe",
            getAuthorizationMode: () => "manual_prepare",
            getEvidence: () => evidence,
            getEligibilityExtras: () => ({
                lastCompareStatus: "matched",
                authoritativeRevision: b.authoritativeRevision,
                candidateRevision: b.candidateRevision,
                inputRevision: b.inputRevision,
                generationMatches: true,
                horizonMatches: true,
                candidateValid: true,
                authoritativePublishOk: true,
                executionMode: "dryrun",
                bound: b,
            }),
        });
        await service.syncFromConfig();
        await service.prepare();
        strict_1.default.equal((await service.confirm("wrong")).ok, false);
        strict_1.default.equal((await service.confirm("wrong")).ok, false);
        const third = await service.confirm("wrong");
        strict_1.default.equal(third.ok, false);
        strict_1.default.equal(third.code, "challenge_invalidated");
    });
    (0, node_test_1.it)("grant is WeakSet-branded and not forged from JSON", () => {
        const challenge = (0, challenge_js_1.createTakeoverChallenge)({
            adapterInstance: "ems.0",
            sessionId: "s",
            nowMs: Date.now(),
            ...bound(),
            idFactory: () => "ch-1",
        });
        const grant = (0, grant_js_1.mintAuthorizationGrantFromChallenge)(challenge, Date.now(), () => "g-1");
        strict_1.default.equal((0, grant_js_1.isAuthorizationGrant)(grant), true);
        strict_1.default.equal((0, grant_js_1.isAuthorizationGrant)(JSON.parse(JSON.stringify(grant))), false);
        strict_1.default.equal((0, grant_js_1.grantExpired)(grant, Date.parse(grant.expiresAt) + 1), true);
        strict_1.default.equal((0, challenge_js_1.challengeExpired)(challenge, Date.parse(challenge.expiresAt) + 1), true);
    });
});
(0, node_test_1.describe)("planner_authorization race replay audit denylist", () => {
    (0, node_test_1.it)("mutex serializes operations", async () => {
        const m = new mutex_js_1.AuthorizationMutex();
        const order = [];
        await Promise.all([
            m.runExclusive(async () => {
                order.push(1);
                await new Promise((r) => setTimeout(r, 20));
                order.push(2);
            }),
            m.runExclusive(async () => {
                order.push(3);
            }),
        ]);
        strict_1.default.deepEqual(order, [1, 2, 3]);
    });
    (0, node_test_1.it)("replay cache is bounded", () => {
        const c = new replay_js_1.ChallengeReplayCache(3);
        c.remember("a", Date.now() + 10_000);
        c.remember("b", Date.now() + 10_000);
        c.remember("c", Date.now() + 10_000);
        c.remember("d", Date.now() + 10_000);
        strict_1.default.equal(c.size(), 3);
        strict_1.default.equal(c.has("a", Date.now()), false);
        strict_1.default.equal(c.has("d", Date.now()), true);
    });
    (0, node_test_1.it)("audit append respects max entries", () => {
        let file = (0, audit_io_js_1.emptyAuditFile)();
        for (let i = 0; i < 5; i++) {
            file = (0, audit_io_js_1.appendAuditEntry)(file, {
                timestamp: new Date().toISOString(),
                eventCode: "x",
                resultCode: "ok",
                challengeIdShort: null,
                grantIdShort: null,
                generation: i,
                inputRevisionShort: null,
                candidateRevisionShort: null,
                authoritativeRevisionShort: null,
                evidenceRevisionShort: null,
                sessionIdShort: "s",
            }, 3);
        }
        strict_1.default.equal(file.entries.length, 3);
    });
    (0, node_test_1.it)("authorization states are denied as planner triggers", () => {
        strict_1.default.equal((0, catalog_js_1.isDeniedPlannerTriggerState)("planner.takeover.authorization.prepare"), true);
        strict_1.default.equal((0, catalog_js_1.isDeniedPlannerTriggerState)("planner.takeover.authorization.confirm"), true);
    });
});

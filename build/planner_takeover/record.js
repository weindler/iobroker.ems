"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIdentityFromCandidates = exports.recordDualRun = void 0;
const compare_1 = require("./compare");
const constants_1 = require("./constants");
const correlation_1 = require("./correlation");
const evidence_1 = require("./evidence");
const evidence_io_1 = require("./evidence_io");
const project_1 = require("./project");
const retention_1 = require("./retention");
const canonize_1 = require("./canonize");
/**
 * Evaluate one dual run and persist evidence when observing.
 * Authoritative publish is never invoked here.
 */
async function recordDualRun(input) {
    const policy = input.policy ?? constants_1.DEFAULT_TAKEOVER_READINESS_POLICY;
    const effective = (0, correlation_1.resolveEffectiveTakeoverEvaluation)({
        plannerRuntimeMode: input.plannerRuntimeMode,
        configuredEvaluationMode: input.configuredEvaluationMode,
    });
    if (!effective.observing) {
        const evidence = (0, evidence_1.sealEvidence)({
            ...(0, evidence_1.emptyTakeoverEvidence)(policy),
            state: "not_evaluated",
            lastBlockReason: input.plannerRuntimeMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto",
        });
        return { evidence, compare: null, observing: false, eligibleConsidered: false };
    }
    const identity = {
        ...input.identity,
        dualRunId: (0, correlation_1.buildDualRunId)(input.identity),
    };
    let compare;
    if (input.shuttingDown) {
        compare = { status: "aborted", mismatchCount: 0, mismatchedSlotCount: 0 };
    }
    else if (!input.authoritativeCandidate) {
        compare = { status: "authoritative_failed", mismatchCount: 0, mismatchedSlotCount: 0 };
    }
    else if (!input.workerCandidate) {
        compare = {
            status: "worker_failed",
            mismatchCount: 0,
            mismatchedSlotCount: 0,
            authoritativeRevision: (0, project_1.projectCandidateToNormalizedPlan)(input.authoritativeCandidate).semanticRevision,
        };
    }
    else {
        const authNorm = (0, project_1.projectCandidateToNormalizedPlan)(input.authoritativeCandidate);
        const workNorm = (0, project_1.projectCandidateToNormalizedPlan)(input.workerCandidate);
        const authIdentity = {
            ...identity,
            planningHorizonStart: authNorm.horizon.start,
            planningHorizonEnd: authNorm.horizon.end,
            slotDurationMinutes: authNorm.horizon.slotMinutes,
        };
        const workIdentity = {
            ...identity,
            planningHorizonStart: workNorm.horizon.start,
            planningHorizonEnd: workNorm.horizon.end,
            slotDurationMinutes: workNorm.horizon.slotMinutes,
            inputRevision: input.workerCandidate.inputRevision,
        };
        const correlation = (0, correlation_1.correlateDualRuns)({
            authoritative: {
                ...authIdentity,
                inputRevision: input.authoritativeCandidate.inputRevision,
            },
            candidate: workIdentity,
        });
        if (correlation.status === "not_comparable") {
            compare = {
                status: "not_comparable",
                mismatchCount: 1,
                mismatchedSlotCount: 0,
                firstMismatchDomain: correlation.reason,
                firstMismatchPath: correlation.reason,
                authoritativeRevision: authNorm.semanticRevision,
                candidateRevision: workNorm.semanticRevision,
            };
        }
        else {
            compare = (0, compare_1.compareNormalizedPlans)(authNorm, workNorm);
        }
    }
    const loaded = await (0, evidence_io_1.readTakeoverEvidenceFile)(input.takeoverDir, policy);
    const evidence = (0, evidence_1.applyDualRunToEvidence)(loaded.evidence, {
        nowIso: input.nowIso,
        observing: true,
        shuttingDown: input.shuttingDown,
        identity,
        compareStatus: compare.status,
        firstMismatchDomain: compare.firstMismatchDomain,
        authoritativeRevision: compare.authoritativeRevision,
        candidateRevision: compare.candidateRevision,
        errorCode: input.errorCode,
        policy,
        diagnosticOnly: input.diagnosticOnly === true || identity.force,
    });
    if (!input.shuttingDown) {
        await (0, evidence_io_1.writeTakeoverEvidenceAtomic)(input.takeoverDir, evidence).catch(() => undefined);
        const keep = [];
        if (input.jobId && (compare.status === "mismatch" || compare.status === "worker_failed")) {
            keep.push(input.jobId);
        }
        await (0, retention_1.retainPlannerCandidates)({
            candidateRootDir: input.candidateRootDir,
            protectedJobIds: input.protectedJobIds,
            keepJobIds: keep,
        }).catch(() => undefined);
    }
    return {
        evidence,
        compare,
        observing: true,
        eligibleConsidered: !(input.diagnosticOnly === true || identity.force) && compare.status !== "aborted",
    };
}
exports.recordDualRun = recordDualRun;
function buildIdentityFromCandidates(input) {
    const slotMinutes = input.authoritative.forecastSlots[0]
        ? (0, canonize_1.slotDurationMinutes)(input.authoritative.forecastSlots[0].start, input.authoritative.forecastSlots[0].end)
        : 15;
    return {
        generation: input.generation,
        triggerClass: input.triggerClass,
        triggerReason: input.triggerReason,
        inputRevision: input.authoritative.inputRevision,
        snapshotSchemaVersion: input.snapshotSchemaVersion,
        planningHorizonStart: input.authoritative.horizonStart,
        planningHorizonEnd: input.authoritative.horizonEnd,
        slotDurationMinutes: slotMinutes,
        force: input.force,
        plannerContractVersion: 1,
    };
}
exports.buildIdentityFromCandidates = buildIdentityFromCandidates;

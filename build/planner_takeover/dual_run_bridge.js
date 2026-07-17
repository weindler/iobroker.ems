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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCoordinatorDualRunOutcome = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const types_1 = require("../planner_candidate/types");
const authoritative_projection_1 = require("./authoritative_projection");
const decision_1 = require("./decision");
const record_1 = require("./record");
const states_1 = require("./states");
/**
 * Dual-run evidence hook.
 * Authoritative candidate MUST come from the once-computed store — never rebuild via
 * buildPlanCandidateFromSnapshot here.
 */
async function handleCoordinatorDualRunOutcome(ctx, event) {
    const runtimeMode = ctx.getPlannerRuntimeMode();
    const evaluationMode = ctx.getConfiguredEvaluationMode();
    if (runtimeMode !== "shadow_auto" || evaluationMode !== "observe") {
        const host = ctx.getStateHost();
        if (host) {
            const { emptyTakeoverEvidence, sealEvidence } = await Promise.resolve().then(() => __importStar(require("./evidence.js")));
            const evidence = sealEvidence({
                ...emptyTakeoverEvidence(),
                state: "not_evaluated",
                lastBlockReason: runtimeMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto",
            });
            const decision = (0, decision_1.resolvePlannerTakeoverDecision)({
                requestedTarget: "canonical",
                evaluationState: "not_evaluated",
                evidence,
            });
            await (0, states_1.writePlannerTakeoverStates)(host, {
                configuredMode: evaluationMode,
                effectiveMode: "disabled",
                evidence,
                decision,
            });
        }
        return;
    }
    const stored = (0, authoritative_projection_1.getActiveAuthoritativeProjection)();
    let authoritative = null;
    const generationMatches = stored != null && stored.generation === event.generation;
    const jobMatches = stored != null && (event.jobId == null || stored.jobId === event.jobId);
    let authFailed = event.authoritativeFailed === true ||
        !(0, authoritative_projection_1.authoritativeProjectionIsUsable)(stored) ||
        !generationMatches ||
        !jobMatches;
    if (!authFailed && (0, authoritative_projection_1.authoritativeProjectionIsUsable)(stored)) {
        // Reuse the exact object from the single authoritative computation — never rebuild.
        authoritative = stored.candidate;
    }
    else {
        authoritative = null;
        authFailed = true;
    }
    let worker = null;
    if (event.jobId) {
        try {
            const raw = fs.readFileSync(path.join(ctx.layout.candidateJobDir(event.jobId), types_1.PLANNER_CANDIDATE_FILE), "utf8");
            worker = JSON.parse(raw);
        }
        catch {
            try {
                const raw = fs.readFileSync(path.join(ctx.layout.jobDir(event.jobId), types_1.PLANNER_CANDIDATE_FILE), "utf8");
                worker = JSON.parse(raw);
            }
            catch {
                worker = null;
            }
        }
    }
    const force = event.trigger.force === true || event.trigger.reason === "manual";
    const identityBase = authoritative
        ? (0, record_1.buildIdentityFromCandidates)({
            generation: event.generation,
            triggerClass: event.trigger.reason,
            triggerReason: event.trigger.reason,
            force,
            authoritative,
            snapshotSchemaVersion: event.snapshot.schemaVersion,
        })
        : {
            generation: event.generation,
            triggerClass: event.trigger.reason,
            triggerReason: event.trigger.reason,
            inputRevision: stored?.inputRevision ?? event.snapshot.inputRevision,
            snapshotSchemaVersion: event.snapshot.schemaVersion,
            planningHorizonStart: stored?.horizonStart ?? "",
            planningHorizonEnd: stored?.horizonEnd ?? "",
            slotDurationMinutes: stored?.slotDurationMinutes ?? 15,
            force,
            plannerContractVersion: 1,
        };
    const recorded = await (0, record_1.recordDualRun)({
        nowIso: new Date().toISOString(),
        plannerRuntimeMode: runtimeMode,
        configuredEvaluationMode: evaluationMode,
        shuttingDown: event.shuttingDown || ctx.isShuttingDown(),
        identity: identityBase,
        authoritativeCandidate: authoritative,
        workerCandidate: worker,
        errorCode: event.authoritativeErrorCode ??
            stored?.publishErrorCode ??
            (authFailed ? "authoritative_failed" : event.errorCode),
        diagnosticOnly: force,
        jobId: event.jobId,
        takeoverDir: ctx.layout.runtimeTakeoverDir,
        candidateRootDir: ctx.layout.runtimeCandidateDir,
        protectedJobIds: ctx.getProtectedJobIds?.(),
    });
    const host = ctx.getStateHost();
    if (host) {
        const decision = (0, decision_1.resolvePlannerTakeoverDecision)({
            requestedTarget: "canonical",
            evaluationState: recorded.evidence.state,
            evidence: recorded.evidence,
            inputRevision: identityBase.inputRevision,
            candidateRevision: recorded.evidence.lastCandidateRevision,
            authoritativeRevision: recorded.evidence.lastAuthoritativeRevision,
            shuttingDown: event.shuttingDown,
        });
        await (0, states_1.writePlannerTakeoverStates)(host, {
            configuredMode: evaluationMode,
            effectiveMode: "observe",
            evidence: recorded.evidence,
            decision,
        });
    }
    try {
        const { configureAuthorizationSession, getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime_session.js")));
        const authRev = recorded.evidence.lastAuthoritativeRevision;
        const candRev = recorded.evidence.lastCandidateRevision;
        configureAuthorizationSession({
            evidence: recorded.evidence,
            lastCompareStatus: recorded.compare?.status ?? event.result,
            authoritativePublishOk: !authFailed && stored?.publishStatus === "ok",
            candidateValid: worker?.validationStatus === "ok" || worker?.validationStatus === "degraded",
            bound: authRev && candRev && identityBase.inputRevision
                ? {
                    generation: event.generation,
                    inputRevision: identityBase.inputRevision,
                    candidateRevision: candRev,
                    authoritativeRevision: authRev,
                    evidenceRevision: recorded.evidence.evidenceRevision,
                    evidencePolicyRevision: recorded.evidence.policyFingerprint,
                    planningHorizonStart: identityBase.planningHorizonStart,
                    planningHorizonEnd: identityBase.planningHorizonEnd,
                    slotDurationMinutes: identityBase.slotDurationMinutes,
                    plannerContractVersion: identityBase.plannerContractVersion ?? 1,
                    snapshotSchemaVersion: event.snapshot.schemaVersion,
                    publishPolicyRevision: "phase_3g_closed",
                }
                : null,
        });
        const svc = getAuthorizationSession().service;
        if (svc && recorded.compare?.status && recorded.compare.status !== "matched") {
            await svc.invalidate(recorded.compare.status);
        }
    }
    catch {
        // authorization session optional
    }
}
exports.handleCoordinatorDualRunOutcome = handleCoordinatorDualRunOutcome;

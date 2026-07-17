"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evidenceStateAllowsPrepare = exports.evaluateAuthorizationEligibility = void 0;
const constants_1 = require("../planner_takeover/constants");
/**
 * Prepare eligibility — does NOT require open release gate or activation capability.
 * Those only appear in permit-mint preview as activation_blocked factors.
 */
function evaluateAuthorizationEligibility(input) {
    const codes = [];
    if (input.authorizationMode !== "manual_prepare")
        codes.push("authorization_disabled");
    if (input.plannerRuntimeMode !== "shadow_auto")
        codes.push("runtime_mode_not_auto");
    if (input.evaluationMode !== "observe")
        codes.push("evaluation_not_observe");
    if (!input.adapterReady)
        codes.push("adapter_not_ready");
    if (input.shuttingDown)
        codes.push("shutdown");
    if (input.restoreBarrierActive)
        codes.push("restore_barrier_active");
    if (input.operationLockActive)
        codes.push("operation_lock_active");
    const evidence = input.evidence;
    if (!evidence || evidence.state !== "ready") {
        codes.push("evidence_not_ready");
    }
    else {
        if (evidence.schemaVersion !== input.expectedEvidenceSchemaVersion) {
            codes.push("evidence_schema_mismatch");
        }
        if (evidence.policyFingerprint !== input.expectedPolicyFingerprint) {
            codes.push("evidence_policy_mismatch");
        }
        const lastEligibleMs = evidence.lastEligibleRunAt ? Date.parse(evidence.lastEligibleRunAt) : NaN;
        if (!Number.isFinite(lastEligibleMs) || input.nowMs - lastEligibleMs > constants_1.TAKEOVER_MAX_STALE_ELIGIBLE_MS) {
            codes.push("evidence_stale");
        }
    }
    if (input.lastCompareStatus !== "matched") {
        if (input.lastCompareStatus === "mismatch")
            codes.push("newer_mismatch");
        else if (input.lastCompareStatus === "authoritative_failed" ||
            input.lastCompareStatus === "worker_failed") {
            codes.push("newer_failure");
        }
        else {
            codes.push("last_run_not_matched");
        }
    }
    if (!input.authoritativeRevision)
        codes.push("missing_authoritative_revision");
    if (!input.candidateRevision)
        codes.push("missing_candidate_revision");
    if (!input.inputRevision)
        codes.push("missing_input_revision");
    if (!input.generationMatches)
        codes.push("generation_mismatch");
    if (!input.horizonMatches)
        codes.push("horizon_mismatch");
    if (!input.candidateValid)
        codes.push("candidate_invalid");
    if (!input.authoritativePublishOk)
        codes.push("authoritative_publish_failed");
    if (input.plannerJobActive)
        codes.push("planner_job_active");
    if (input.pendingRerun)
        codes.push("pending_rerun");
    if (input.executionMode !== "dryrun")
        codes.push("execution_mode_not_dryrun");
    if (input.challengeActive)
        codes.push("challenge_active");
    if (input.grantActive)
        codes.push("grant_active");
    const unique = [...new Set(codes)];
    return {
        eligible: unique.length === 0,
        codes: unique,
        primaryCode: unique[0] ?? null,
    };
}
exports.evaluateAuthorizationEligibility = evaluateAuthorizationEligibility;
function evidenceStateAllowsPrepare(state) {
    return state === "ready";
}
exports.evidenceStateAllowsPrepare = evidenceStateAllowsPrepare;

"use strict";
/**
 * Authoritative dual-run projection — computed exactly once per dual run.
 * Compare / evidence paths MUST reuse this object and must not call
 * buildPlanCandidateFromSnapshot again for the authoritative side.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.authoritativeProjectionIsUsable = exports.forbidAuthoritativeRecompute = exports.computeAuthoritativeDualRunProjection = exports.clearActiveAuthoritativeProjection = exports.getActiveAuthoritativeProjection = exports.resetAuthoritativeProjectionCountersForTest = exports.getForbiddenRecomputeAttemptsForTest = exports.getAuthoritativeComputeCountForTest = void 0;
const build_1 = require("../planner_candidate/build");
let active = null;
/** Test / diagnostics: how often the authoritative pure core ran. */
let authoritativeComputeCount = 0;
/** Test: how often compare/evidence attempted a forbidden recomputation helper. */
let forbiddenRecomputeAttempts = 0;
function getAuthoritativeComputeCountForTest() {
    return authoritativeComputeCount;
}
exports.getAuthoritativeComputeCountForTest = getAuthoritativeComputeCountForTest;
function getForbiddenRecomputeAttemptsForTest() {
    return forbiddenRecomputeAttempts;
}
exports.getForbiddenRecomputeAttemptsForTest = getForbiddenRecomputeAttemptsForTest;
function resetAuthoritativeProjectionCountersForTest() {
    authoritativeComputeCount = 0;
    forbiddenRecomputeAttempts = 0;
    active = null;
}
exports.resetAuthoritativeProjectionCountersForTest = resetAuthoritativeProjectionCountersForTest;
function getActiveAuthoritativeProjection() {
    return active;
}
exports.getActiveAuthoritativeProjection = getActiveAuthoritativeProjection;
function clearActiveAuthoritativeProjection() {
    active = null;
}
exports.clearActiveAuthoritativeProjection = clearActiveAuthoritativeProjection;
/**
 * Single authoritative computation for a dual run.
 * Callers must not invoke buildPlanCandidateFromSnapshot again for the same run's reference side.
 */
function computeAuthoritativeDualRunProjection(input) {
    authoritativeComputeCount += 1;
    const built = (0, build_1.buildPlanCandidateFromSnapshot)(input.snapshot);
    const candidate = built.candidate;
    const first = candidate.forecastSlots[0];
    const slotDurationMinutes = first != null
        ? Math.max(1, Math.round((Date.parse(first.end) - Date.parse(first.start)) / 60_000))
        : 15;
    let publishStatus = "ok";
    let publishErrorCode;
    if (input.sealPublish) {
        try {
            const ok = input.sealPublish(candidate);
            if (!ok) {
                publishStatus = "failed";
                publishErrorCode = "authoritative_publish_failed";
            }
        }
        catch (e) {
            publishStatus = "failed";
            publishErrorCode = "authoritative_publish_failed";
            void e;
        }
    }
    else {
        publishStatus = "ok";
    }
    active = {
        generation: input.generation,
        jobId: input.jobId,
        inputRevision: input.snapshot.inputRevision,
        snapshotSchemaVersion: input.snapshot.schemaVersion,
        horizonStart: candidate.horizonStart,
        horizonEnd: candidate.horizonEnd,
        slotDurationMinutes,
        candidate,
        publishStatus,
        publishErrorCode,
        computedAt: input.nowIso ?? new Date().toISOString(),
    };
    return active;
}
exports.computeAuthoritativeDualRunProjection = computeAuthoritativeDualRunProjection;
/**
 * Explicitly mark that a dual-run path attempted to rebuild the authoritative
 * reference — forbidden. Increments diagnostic counter and returns null.
 */
function forbidAuthoritativeRecompute() {
    forbiddenRecomputeAttempts += 1;
    return null;
}
exports.forbidAuthoritativeRecompute = forbidAuthoritativeRecompute;
function authoritativeProjectionIsUsable(projection) {
    return (projection != null &&
        projection.publishStatus === "ok" &&
        projection.candidate != null);
}
exports.authoritativeProjectionIsUsable = authoritativeProjectionIsUsable;

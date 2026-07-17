"use strict";
/**
 * Canonical publish permit — Phase 3H worker-dryrun scope.
 * Minted only from an active worker-dryrun authority lease (itself only mintable
 * from a grant-derived activation capability). Branded via WeakSet; single-use
 * (consumePermit). Never enables live publish.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumePermit = exports.permitExpired = exports.isCanonicalPublishPermit = exports.mintWorkerDryrunCanonicalPublishPermit = exports.tryMintCanonicalPublishPermitFromShadow = exports.requireCanonicalPublishPermit = exports.WORKER_DRYRUN_PUBLISH_PERMIT_TTL_MS = void 0;
/** Short permit lifetime — one publish cycle. */
exports.WORKER_DRYRUN_PUBLISH_PERMIT_TTL_MS = 60 * 1000;
const mintedPermits = new WeakSet();
function requireCanonicalPublishPermit(permit) {
    return permit;
}
exports.requireCanonicalPublishPermit = requireCanonicalPublishPermit;
/**
 * Phase 3H: config/evidence/shadow alone never yields a permit.
 */
function tryMintCanonicalPublishPermitFromShadow(_input) {
    return null;
}
exports.tryMintCanonicalPublishPermitFromShadow = tryMintCanonicalPublishPermitFromShadow;
/**
 * Mint a single-use worker-dryrun publish permit from an active lease.
 * The caller (authority service) must have validated its lease brand + expiry and
 * pass leaseActive=true; the permit carries the revisions publish.ts re-verifies.
 */
function mintWorkerDryrunCanonicalPublishPermit(input) {
    if (!input.leaseActive || !input.leaseId)
        return null;
    if (!input.planRevision)
        return null;
    const ttl = Math.max(0, input.ttlMs ?? exports.WORKER_DRYRUN_PUBLISH_PERMIT_TTL_MS);
    const permit = {
        scope: "worker_dryrun",
        executionMode: "dryrun",
        adapterInstance: input.adapterInstance,
        sessionId: input.sessionId,
        grantId: input.grantId,
        leaseId: input.leaseId,
        generation: input.generation,
        inputRevision: input.inputRevision,
        candidateRevision: input.candidateRevision,
        authoritativeRevision: input.authoritativeRevision,
        evidenceRevision: input.evidenceRevision,
        planRevision: input.planRevision,
        issuedAt: new Date(input.nowMs).toISOString(),
        expiresAt: new Date(input.nowMs + ttl).toISOString(),
        consumed: false,
    };
    mintedPermits.add(permit);
    return permit;
}
exports.mintWorkerDryrunCanonicalPublishPermit = mintWorkerDryrunCanonicalPublishPermit;
function isCanonicalPublishPermit(value) {
    return typeof value === "object" && value !== null && mintedPermits.has(value);
}
exports.isCanonicalPublishPermit = isCanonicalPublishPermit;
function permitExpired(permit, nowMs) {
    return Date.parse(permit.expiresAt) <= nowMs;
}
exports.permitExpired = permitExpired;
/** Mark a permit consumed. Returns false if already consumed or unrecognized. */
function consumePermit(permit) {
    if (!isCanonicalPublishPermit(permit))
        return false;
    if (permit.consumed)
        return false;
    permit.consumed = true;
    return true;
}
exports.consumePermit = consumePermit;

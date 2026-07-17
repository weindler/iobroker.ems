"use strict";
/**
 * Worker-dryrun authority lease — branded via WeakSet mint registry.
 * Never JSON-persisted, never written to states, never sent to worker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.leaseExpired = exports.isWorkerDryrunAuthorityLease = exports.mintWorkerDryrunAuthorityLease = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
const activation_1 = require("../planner_authorization/activation");
const mintedLeases = new WeakSet();
/** Mint a lease from a valid worker-dryrun activation capability. */
function mintWorkerDryrunAuthorityLease(input) {
    const cap = input.capability;
    if (!(0, activation_1.isProductiveActivationCapability)(cap))
        return null;
    if ((0, activation_1.activationCapabilityExpired)(cap, input.nowMs))
        return null;
    if (cap.scope !== "worker_dryrun" || cap.executionMode !== "dryrun")
        return null;
    const ttl = Math.max(0, input.ttlMs ?? constants_1.WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS);
    const lease = {
        leaseId: (input.idFactory ?? (() => (0, node_crypto_1.randomUUID)()))(),
        adapterInstance: cap.adapterInstance,
        sessionId: cap.sessionId,
        grantId: cap.grantId,
        generation: cap.generation,
        inputRevision: cap.inputRevision,
        candidateRevision: cap.candidateRevision,
        authoritativeRevision: cap.authoritativeRevision,
        evidenceRevision: cap.evidenceRevision,
        issuedAt: new Date(input.nowMs).toISOString(),
        expiresAt: new Date(input.nowMs + ttl).toISOString(),
    };
    mintedLeases.add(lease);
    return lease;
}
exports.mintWorkerDryrunAuthorityLease = mintWorkerDryrunAuthorityLease;
function isWorkerDryrunAuthorityLease(value) {
    return typeof value === "object" && value !== null && mintedLeases.has(value);
}
exports.isWorkerDryrunAuthorityLease = isWorkerDryrunAuthorityLease;
function leaseExpired(lease, nowMs) {
    return Date.parse(lease.expiresAt) <= nowMs;
}
exports.leaseExpired = leaseExpired;

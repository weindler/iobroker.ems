"use strict";
/**
 * Worker-dryrun activation capability — Phase 3H.
 * Minted only from a valid Authorization-Grant, branded via WeakSet.
 * Never enables live execution; scope is fixed to "worker_dryrun".
 * There is intentionally NO config/state/evidence-only mint.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireProductiveActivationCapability = exports.activationCapabilityExpired = exports.isProductiveActivationCapability = exports.mintWorkerDryrunActivationCapabilityFromGrant = exports.tryMintProductiveActivationCapability = exports.WORKER_DRYRUN_ACTIVATION_CAPABILITY_TTL_MS = void 0;
const grant_1 = require("./grant");
/** Short capability lifetime — bounded by grant remaining, capped at this. */
exports.WORKER_DRYRUN_ACTIVATION_CAPABILITY_TTL_MS = 2 * 60 * 1000;
const mintedCapabilities = new WeakSet();
/**
 * No config/state/evidence combination can mint a capability on its own.
 * A valid Authorization-Grant is mandatory (see mintWorkerDryrunActivationCapabilityFromGrant).
 */
function tryMintProductiveActivationCapability(_input) {
    return null;
}
exports.tryMintProductiveActivationCapability = tryMintProductiveActivationCapability;
/**
 * Mint a worker-dryrun activation capability from an authenticated grant.
 * All revision fields must match the grant; execution mode must be dryrun.
 */
function mintWorkerDryrunActivationCapabilityFromGrant(input) {
    const { grant } = input;
    if (!(0, grant_1.isAuthorizationGrant)(grant))
        return null;
    if ((0, grant_1.grantExpired)(grant, input.nowMs))
        return null;
    if (grant.executionMode !== "dryrun")
        return null;
    if (grant.generation !== input.generation)
        return null;
    if (grant.inputRevision !== input.inputRevision)
        return null;
    if (grant.candidateRevision !== input.candidateRevision)
        return null;
    if (grant.authoritativeRevision !== input.authoritativeRevision)
        return null;
    if (grant.evidenceRevision !== input.evidenceRevision)
        return null;
    const grantRemaining = Math.max(0, Date.parse(grant.expiresAt) - input.nowMs);
    const ttl = Math.max(0, Math.min(input.ttlMs ?? exports.WORKER_DRYRUN_ACTIVATION_CAPABILITY_TTL_MS, grantRemaining));
    const capability = {
        scope: "worker_dryrun",
        executionMode: "dryrun",
        adapterInstance: grant.adapterInstance,
        sessionId: grant.sessionId,
        grantId: grant.grantId,
        generation: grant.generation,
        inputRevision: grant.inputRevision,
        candidateRevision: grant.candidateRevision,
        authoritativeRevision: grant.authoritativeRevision,
        evidenceRevision: grant.evidenceRevision,
        issuedAt: new Date(input.nowMs).toISOString(),
        expiresAt: new Date(input.nowMs + ttl).toISOString(),
    };
    mintedCapabilities.add(capability);
    return capability;
}
exports.mintWorkerDryrunActivationCapabilityFromGrant = mintWorkerDryrunActivationCapabilityFromGrant;
function isProductiveActivationCapability(value) {
    return typeof value === "object" && value !== null && mintedCapabilities.has(value);
}
exports.isProductiveActivationCapability = isProductiveActivationCapability;
function activationCapabilityExpired(cap, nowMs) {
    return Date.parse(cap.expiresAt) <= nowMs;
}
exports.activationCapabilityExpired = activationCapabilityExpired;
function requireProductiveActivationCapability(cap) {
    return cap;
}
exports.requireProductiveActivationCapability = requireProductiveActivationCapability;

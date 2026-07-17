"use strict";
/**
 * Authorization grant — branded via WeakSet mint registry.
 * Never JSON-persisted, never written to ioBroker states, never sent to worker.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearGrantRegistryForTest = exports.grantExpired = exports.isAuthorizationGrant = exports.mintAuthorizationGrantFromChallenge = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
const mintedGrants = new WeakSet();
/** Internal mint — only this module may create recognized grants. */
function mintAuthorizationGrantFromChallenge(challenge, nowMs, idFactory = () => (0, node_crypto_1.randomUUID)(), ttlMs = constants_1.TAKEOVER_AUTHORIZATION_GRANT_TTL_MS) {
    const grant = {
        grantId: idFactory(),
        challengeId: challenge.challengeId,
        adapterInstance: challenge.adapterInstance,
        sessionId: challenge.sessionId,
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + ttlMs).toISOString(),
        generation: challenge.generation,
        inputRevision: challenge.inputRevision,
        candidateRevision: challenge.candidateRevision,
        authoritativeRevision: challenge.authoritativeRevision,
        evidenceRevision: challenge.evidenceRevision,
        evidencePolicyRevision: challenge.evidencePolicyRevision,
        executionMode: "dryrun",
        plannerContractVersion: challenge.plannerContractVersion,
        snapshotSchemaVersion: challenge.snapshotSchemaVersion,
        publishPolicyRevision: challenge.publishPolicyRevision,
    };
    mintedGrants.add(grant);
    return grant;
}
exports.mintAuthorizationGrantFromChallenge = mintAuthorizationGrantFromChallenge;
function isAuthorizationGrant(value) {
    return typeof value === "object" && value !== null && mintedGrants.has(value);
}
exports.isAuthorizationGrant = isAuthorizationGrant;
function grantExpired(grant, nowMs) {
    return Date.parse(grant.expiresAt) <= nowMs;
}
exports.grantExpired = grantExpired;
/** Test helper — does not mint; only clears registry of dead objects (WeakSet is automatic). */
function clearGrantRegistryForTest() {
    // WeakSet cannot be cleared; tests rely on fresh objects.
}
exports.clearGrantRegistryForTest = clearGrantRegistryForTest;

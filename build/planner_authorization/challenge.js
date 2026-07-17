"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortenId = exports.challengeExpired = exports.createTakeoverChallenge = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
function createTakeoverChallenge(input) {
    const idFactory = input.idFactory ?? (() => (0, node_crypto_1.randomUUID)());
    const ttl = input.ttlMs ?? constants_1.TAKEOVER_CHALLENGE_TTL_MS;
    return {
        schemaVersion: constants_1.TAKEOVER_CHALLENGE_SCHEMA_VERSION,
        challengeId: idFactory(),
        adapterInstance: input.adapterInstance,
        sessionId: input.sessionId,
        createdAt: new Date(input.nowMs).toISOString(),
        expiresAt: new Date(input.nowMs + ttl).toISOString(),
        generation: input.generation,
        inputRevision: input.inputRevision,
        candidateRevision: input.candidateRevision,
        authoritativeRevision: input.authoritativeRevision,
        evidenceRevision: input.evidenceRevision,
        evidencePolicyRevision: input.evidencePolicyRevision,
        planningHorizonStart: input.planningHorizonStart,
        planningHorizonEnd: input.planningHorizonEnd,
        slotDurationMinutes: input.slotDurationMinutes,
        executionMode: "dryrun",
        consumed: false,
        confirmFailures: 0,
        plannerContractVersion: input.plannerContractVersion,
        snapshotSchemaVersion: input.snapshotSchemaVersion,
        publishPolicyRevision: input.publishPolicyRevision,
    };
}
exports.createTakeoverChallenge = createTakeoverChallenge;
function challengeExpired(challenge, nowMs) {
    return Date.parse(challenge.expiresAt) <= nowMs;
}
exports.challengeExpired = challengeExpired;
function shortenId(id, length = 8) {
    if (!id)
        return null;
    return id.slice(0, length);
}
exports.shortenId = shortenId;

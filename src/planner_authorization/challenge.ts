import { randomUUID } from "node:crypto";
import { TAKEOVER_CHALLENGE_SCHEMA_VERSION, TAKEOVER_CHALLENGE_TTL_MS } from "./constants";
import type { PlannerTakeoverChallenge } from "./types";

export type ChallengeIdFactory = () => string;

export interface CreateChallengeInput {
	adapterInstance: string;
	sessionId: string;
	nowMs: number;
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	evidencePolicyRevision: string;
	planningHorizonStart: string;
	planningHorizonEnd: string;
	slotDurationMinutes: number;
	plannerContractVersion: number;
	snapshotSchemaVersion: number;
	publishPolicyRevision: string;
	idFactory?: ChallengeIdFactory;
	ttlMs?: number;
}

export function createTakeoverChallenge(input: CreateChallengeInput): PlannerTakeoverChallenge {
	const idFactory = input.idFactory ?? (() => randomUUID());
	const ttl = input.ttlMs ?? TAKEOVER_CHALLENGE_TTL_MS;
	return {
		schemaVersion: TAKEOVER_CHALLENGE_SCHEMA_VERSION,
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

export function challengeExpired(challenge: PlannerTakeoverChallenge, nowMs: number): boolean {
	return Date.parse(challenge.expiresAt) <= nowMs;
}

export function shortenId(id: string | null | undefined, length = 8): string | null {
	if (!id) return null;
	return id.slice(0, length);
}

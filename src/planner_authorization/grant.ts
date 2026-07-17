/**
 * Authorization grant — branded via WeakSet mint registry.
 * Never JSON-persisted, never written to ioBroker states, never sent to worker.
 */

import { randomUUID } from "node:crypto";
import { TAKEOVER_AUTHORIZATION_GRANT_TTL_MS } from "./constants";
import type { PlannerTakeoverChallenge } from "./types";

declare const authorizationGrantBrand: unique symbol;

export interface PlannerTakeoverAuthorizationGrant {
	readonly [authorizationGrantBrand]: true;
	readonly grantId: string;
	readonly challengeId: string;
	readonly adapterInstance: string;
	readonly sessionId: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
	readonly generation: number;
	readonly inputRevision: string;
	readonly candidateRevision: string;
	readonly authoritativeRevision: string;
	readonly evidenceRevision: string;
	readonly evidencePolicyRevision: string;
	readonly executionMode: "dryrun";
	readonly plannerContractVersion: number;
	readonly snapshotSchemaVersion: number;
	readonly publishPolicyRevision: string;
}

const mintedGrants = new WeakSet<object>();

/** Internal mint — only this module may create recognized grants. */
export function mintAuthorizationGrantFromChallenge(
	challenge: PlannerTakeoverChallenge,
	nowMs: number,
	idFactory: () => string = () => randomUUID(),
	ttlMs: number = TAKEOVER_AUTHORIZATION_GRANT_TTL_MS,
): PlannerTakeoverAuthorizationGrant {
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
		executionMode: "dryrun" as const,
		plannerContractVersion: challenge.plannerContractVersion,
		snapshotSchemaVersion: challenge.snapshotSchemaVersion,
		publishPolicyRevision: challenge.publishPolicyRevision,
	};
	mintedGrants.add(grant);
	return grant as PlannerTakeoverAuthorizationGrant;
}

export function isAuthorizationGrant(value: unknown): value is PlannerTakeoverAuthorizationGrant {
	return typeof value === "object" && value !== null && mintedGrants.has(value);
}

export function grantExpired(grant: PlannerTakeoverAuthorizationGrant, nowMs: number): boolean {
	return Date.parse(grant.expiresAt) <= nowMs;
}

/** Test helper — does not mint; only clears registry of dead objects (WeakSet is automatic). */
export function clearGrantRegistryForTest(): void {
	// WeakSet cannot be cleared; tests rely on fresh objects.
}

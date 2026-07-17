/**
 * Canonical publish permit — Phase 3H worker-dryrun scope.
 * Minted only from an active worker-dryrun authority lease (itself only mintable
 * from a grant-derived activation capability). Branded via WeakSet; single-use
 * (consumePermit). Never enables live publish.
 */

declare const canonicalPermitBrand: unique symbol;

/** Short permit lifetime — one publish cycle. */
export const WORKER_DRYRUN_PUBLISH_PERMIT_TTL_MS = 60 * 1000;

export interface CanonicalPublishPermit {
	readonly [canonicalPermitBrand]: true;
	readonly scope: "worker_dryrun";
	readonly executionMode: "dryrun";
	readonly adapterInstance: string;
	readonly sessionId: string;
	readonly grantId: string;
	readonly leaseId: string;
	readonly generation: number;
	readonly inputRevision: string;
	readonly candidateRevision: string;
	readonly authoritativeRevision: string;
	readonly evidenceRevision: string;
	/** Revision of the plan to be written (canonical candidate revision). */
	readonly planRevision: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
	consumed: boolean;
}

const mintedPermits = new WeakSet<object>();

export function requireCanonicalPublishPermit(permit: CanonicalPublishPermit): CanonicalPublishPermit {
	return permit;
}

/**
 * Phase 3H: config/evidence/shadow alone never yields a permit.
 */
export function tryMintCanonicalPublishPermitFromShadow(_input: {
	evaluationState?: string;
	requestedTarget?: string;
	productiveTakeoverMode?: boolean;
	config?: unknown;
	evidence?: unknown;
	workerResult?: unknown;
	authorizationGrant?: unknown;
	productiveActivation?: unknown;
}): CanonicalPublishPermit | null {
	return null;
}

export interface WorkerDryrunPublishPermitMintInput {
	/** True only when the caller holds a branded, non-expired worker-dryrun lease. */
	leaseActive: boolean;
	leaseId: string;
	adapterInstance: string;
	sessionId: string;
	grantId: string;
	nowMs: number;
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	planRevision: string;
	ttlMs?: number;
}

/**
 * Mint a single-use worker-dryrun publish permit from an active lease.
 * The caller (authority service) must have validated its lease brand + expiry and
 * pass leaseActive=true; the permit carries the revisions publish.ts re-verifies.
 */
export function mintWorkerDryrunCanonicalPublishPermit(
	input: WorkerDryrunPublishPermitMintInput,
): CanonicalPublishPermit | null {
	if (!input.leaseActive || !input.leaseId) return null;
	if (!input.planRevision) return null;

	const ttl = Math.max(0, input.ttlMs ?? WORKER_DRYRUN_PUBLISH_PERMIT_TTL_MS);
	const permit = {
		scope: "worker_dryrun" as const,
		executionMode: "dryrun" as const,
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
	return permit as CanonicalPublishPermit;
}

export function isCanonicalPublishPermit(value: unknown): value is CanonicalPublishPermit {
	return typeof value === "object" && value !== null && mintedPermits.has(value);
}

export function permitExpired(permit: CanonicalPublishPermit, nowMs: number): boolean {
	return Date.parse(permit.expiresAt) <= nowMs;
}

/** Mark a permit consumed. Returns false if already consumed or unrecognized. */
export function consumePermit(permit: CanonicalPublishPermit): boolean {
	if (!isCanonicalPublishPermit(permit)) return false;
	if (permit.consumed) return false;
	permit.consumed = true;
	return true;
}

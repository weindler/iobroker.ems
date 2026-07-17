/**
 * Worker-dryrun activation capability — Phase 3H.
 * Minted only from a valid Authorization-Grant, branded via WeakSet.
 * Never enables live execution; scope is fixed to "worker_dryrun".
 * There is intentionally NO config/state/evidence-only mint.
 */

import { isAuthorizationGrant, grantExpired, type PlannerTakeoverAuthorizationGrant } from "./grant";

declare const productiveActivationBrand: unique symbol;

/** Short capability lifetime — bounded by grant remaining, capped at this. */
export const WORKER_DRYRUN_ACTIVATION_CAPABILITY_TTL_MS = 2 * 60 * 1000;

export interface ProductiveTakeoverActivationCapability {
	readonly [productiveActivationBrand]: true;
	readonly scope: "worker_dryrun";
	readonly executionMode: "dryrun";
	readonly adapterInstance: string;
	readonly sessionId: string;
	readonly grantId: string;
	readonly generation: number;
	readonly inputRevision: string;
	readonly candidateRevision: string;
	readonly authoritativeRevision: string;
	readonly evidenceRevision: string;
	readonly issuedAt: string;
	readonly expiresAt: string;
}

const mintedCapabilities = new WeakSet<object>();

/**
 * No config/state/evidence combination can mint a capability on its own.
 * A valid Authorization-Grant is mandatory (see mintWorkerDryrunActivationCapabilityFromGrant).
 */
export function tryMintProductiveActivationCapability(_input: {
	authorizationMode?: string;
	evaluationState?: string;
	grantPresent?: boolean;
	evidenceReady?: boolean;
	config?: unknown;
	statePayload?: unknown;
}): ProductiveTakeoverActivationCapability | null {
	return null;
}

export interface WorkerDryrunActivationMintInput {
	grant: PlannerTakeoverAuthorizationGrant;
	nowMs: number;
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	ttlMs?: number;
}

/**
 * Mint a worker-dryrun activation capability from an authenticated grant.
 * All revision fields must match the grant; execution mode must be dryrun.
 */
export function mintWorkerDryrunActivationCapabilityFromGrant(
	input: WorkerDryrunActivationMintInput,
): ProductiveTakeoverActivationCapability | null {
	const { grant } = input;
	if (!isAuthorizationGrant(grant)) return null;
	if (grantExpired(grant, input.nowMs)) return null;
	if (grant.executionMode !== "dryrun") return null;
	if (grant.generation !== input.generation) return null;
	if (grant.inputRevision !== input.inputRevision) return null;
	if (grant.candidateRevision !== input.candidateRevision) return null;
	if (grant.authoritativeRevision !== input.authoritativeRevision) return null;
	if (grant.evidenceRevision !== input.evidenceRevision) return null;

	const grantRemaining = Math.max(0, Date.parse(grant.expiresAt) - input.nowMs);
	const ttl = Math.max(
		0,
		Math.min(input.ttlMs ?? WORKER_DRYRUN_ACTIVATION_CAPABILITY_TTL_MS, grantRemaining),
	);
	const capability = {
		scope: "worker_dryrun" as const,
		executionMode: "dryrun" as const,
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
	return capability as ProductiveTakeoverActivationCapability;
}

export function isProductiveActivationCapability(
	value: unknown,
): value is ProductiveTakeoverActivationCapability {
	return typeof value === "object" && value !== null && mintedCapabilities.has(value);
}

export function activationCapabilityExpired(
	cap: ProductiveTakeoverActivationCapability,
	nowMs: number,
): boolean {
	return Date.parse(cap.expiresAt) <= nowMs;
}

export function requireProductiveActivationCapability(
	cap: ProductiveTakeoverActivationCapability,
): ProductiveTakeoverActivationCapability {
	return cap;
}

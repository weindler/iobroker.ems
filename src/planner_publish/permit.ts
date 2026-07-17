/**
 * Capability-based canonical publish permit.
 * Phase 3G: requires valid Authorization-Grant AND ProductiveTakeoverActivationCapability.
 * No productive path may mint either the activation capability or this permit.
 */

declare const canonicalPermitBrand: unique symbol;

export interface CanonicalPublishPermit {
	readonly [canonicalPermitBrand]: true;
}

export function requireCanonicalPublishPermit(permit: CanonicalPublishPermit): CanonicalPublishPermit {
	return permit;
}

/**
 * Always null in Phase 3F/3G — no shadow/config/evidence combination yields a permit.
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

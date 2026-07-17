/**
 * Capability-based canonical publish permit.
 * Phase 3F: no productive code path may mint this permit.
 * Functions that could publish canonical must require CanonicalPublishPermit.
 */

declare const canonicalPermitBrand: unique symbol;

export interface CanonicalPublishPermit {
	readonly [canonicalPermitBrand]: true;
}

/**
 * Type-level assertion helper for future canonical publish.
 * There is intentionally no exported mint/create function in Phase 3F.
 */
export function requireCanonicalPublishPermit(permit: CanonicalPublishPermit): CanonicalPublishPermit {
	return permit;
}

/** Compile-time / runtime proof that Phase 3F never yields a permit from config or evidence. */
export function tryMintCanonicalPublishPermitFromShadow(_input: {
	evaluationState?: string;
	requestedTarget?: string;
	productiveTakeoverMode?: boolean;
	config?: unknown;
	evidence?: unknown;
	workerResult?: unknown;
}): CanonicalPublishPermit | null {
	// Hard closed — no combination of Phase-3F inputs produces a permit.
	return null;
}

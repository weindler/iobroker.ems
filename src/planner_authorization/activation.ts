/**
 * Productive takeover activation capability — Phase 3G hard lock.
 * There is intentionally NO productive mint/create function.
 */

declare const productiveActivationBrand: unique symbol;

export interface ProductiveTakeoverActivationCapability {
	readonly [productiveActivationBrand]: true;
}

/**
 * Always returns null in Phase 3G. No config/state/evidence/grant combination can mint.
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

export function requireProductiveActivationCapability(
	cap: ProductiveTakeoverActivationCapability,
): ProductiveTakeoverActivationCapability {
	return cap;
}

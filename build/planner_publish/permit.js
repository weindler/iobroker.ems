"use strict";
/**
 * Capability-based canonical publish permit.
 * Phase 3F: no productive code path may mint this permit.
 * Functions that could publish canonical must require CanonicalPublishPermit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryMintCanonicalPublishPermitFromShadow = exports.requireCanonicalPublishPermit = void 0;
/**
 * Type-level assertion helper for future canonical publish.
 * There is intentionally no exported mint/create function in Phase 3F.
 */
function requireCanonicalPublishPermit(permit) {
    return permit;
}
exports.requireCanonicalPublishPermit = requireCanonicalPublishPermit;
/** Compile-time / runtime proof that Phase 3F never yields a permit from config or evidence. */
function tryMintCanonicalPublishPermitFromShadow(_input) {
    // Hard closed — no combination of Phase-3F inputs produces a permit.
    return null;
}
exports.tryMintCanonicalPublishPermitFromShadow = tryMintCanonicalPublishPermitFromShadow;

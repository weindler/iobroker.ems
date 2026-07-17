"use strict";
/**
 * Capability-based canonical publish permit.
 * Phase 3G: requires valid Authorization-Grant AND ProductiveTakeoverActivationCapability.
 * No productive path may mint either the activation capability or this permit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryMintCanonicalPublishPermitFromShadow = exports.requireCanonicalPublishPermit = void 0;
function requireCanonicalPublishPermit(permit) {
    return permit;
}
exports.requireCanonicalPublishPermit = requireCanonicalPublishPermit;
/**
 * Always null in Phase 3F/3G — no shadow/config/evidence combination yields a permit.
 */
function tryMintCanonicalPublishPermitFromShadow(_input) {
    return null;
}
exports.tryMintCanonicalPublishPermitFromShadow = tryMintCanonicalPublishPermitFromShadow;

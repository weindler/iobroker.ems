"use strict";
/**
 * Productive takeover activation capability — Phase 3G hard lock.
 * There is intentionally NO productive mint/create function.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireProductiveActivationCapability = exports.tryMintProductiveActivationCapability = void 0;
/**
 * Always returns null in Phase 3G. No config/state/evidence/grant combination can mint.
 */
function tryMintProductiveActivationCapability(_input) {
    return null;
}
exports.tryMintProductiveActivationCapability = tryMintProductiveActivationCapability;
function requireProductiveActivationCapability(cap) {
    return cap;
}
exports.requireProductiveActivationCapability = requireProductiveActivationCapability;

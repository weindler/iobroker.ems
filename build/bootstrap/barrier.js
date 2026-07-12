"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetBootstrapBarrierForTest = exports.markBootstrapComplete = exports.markBootstrapFailed = exports.bootstrapFailurePhase = exports.isBootstrapComplete = void 0;
/** Verhindert Geräte-Runtime vor abgeschlossenem State-Bootstrap. */
let bootstrapComplete = false;
let bootstrapFailedPhase = null;
function isBootstrapComplete() {
    return bootstrapComplete;
}
exports.isBootstrapComplete = isBootstrapComplete;
function bootstrapFailurePhase() {
    return bootstrapFailedPhase;
}
exports.bootstrapFailurePhase = bootstrapFailurePhase;
function markBootstrapFailed(phase) {
    if (!bootstrapFailedPhase) {
        bootstrapFailedPhase = phase;
    }
}
exports.markBootstrapFailed = markBootstrapFailed;
function markBootstrapComplete() {
    bootstrapComplete = true;
}
exports.markBootstrapComplete = markBootstrapComplete;
/** Nur für Tests — Bootstrap-Zustand zurücksetzen. */
function resetBootstrapBarrierForTest() {
    bootstrapComplete = false;
    bootstrapFailedPhase = null;
}
exports.resetBootstrapBarrierForTest = resetBootstrapBarrierForTest;

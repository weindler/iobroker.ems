"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBootstrapComplete = isBootstrapComplete;
exports.bootstrapFailurePhase = bootstrapFailurePhase;
exports.markBootstrapFailed = markBootstrapFailed;
exports.markBootstrapComplete = markBootstrapComplete;
exports.resetBootstrapBarrierForTest = resetBootstrapBarrierForTest;
/** Verhindert Geräte-Runtime vor abgeschlossenem State-Bootstrap. */
let bootstrapComplete = false;
let bootstrapFailedPhase = null;
function isBootstrapComplete() {
    return bootstrapComplete;
}
function bootstrapFailurePhase() {
    return bootstrapFailedPhase;
}
function markBootstrapFailed(phase) {
    if (!bootstrapFailedPhase) {
        bootstrapFailedPhase = phase;
    }
}
function markBootstrapComplete() {
    bootstrapComplete = true;
}
/** Nur für Tests — Bootstrap-Zustand zurücksetzen. */
function resetBootstrapBarrierForTest() {
    bootstrapComplete = false;
    bootstrapFailedPhase = null;
}

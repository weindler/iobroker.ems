"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyOwnership = emptyOwnership;
exports.canSafeRestore = canSafeRestore;
exports.isForeignManualControl = isForeignManualControl;
function emptyOwnership() {
    return {
        active: false,
        requestId: null,
        startedAt: null,
        originalMode: null,
        manualModeWritten: false,
    };
}
/** Safe Restore nur, wenn EMS die Batterie selbst in den manuellen Modus versetzt hat. */
function canSafeRestore(ownership) {
    return ownership.active && ownership.manualModeWritten;
}
/**
 * Fremde manuelle Steuerung: Gerät steht im manuellen Modus, ohne dass aktuelle
 * EMS-Ownership nachweisbar ist. EMS darf das nicht ungefragt überschreiben.
 */
function isForeignManualControl(input) {
    return input.currentMode === input.manualModeValue && !input.ownership.active;
}

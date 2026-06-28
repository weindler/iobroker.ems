"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isForeignManualControl = exports.canSafeRestore = exports.emptyOwnership = void 0;
function emptyOwnership() {
    return {
        active: false,
        requestId: null,
        startedAt: null,
        originalMode: null,
        manualModeWritten: false,
    };
}
exports.emptyOwnership = emptyOwnership;
/** Safe Restore nur, wenn EMS die Batterie selbst in den manuellen Modus versetzt hat. */
function canSafeRestore(ownership) {
    return ownership.active && ownership.manualModeWritten;
}
exports.canSafeRestore = canSafeRestore;
/**
 * Fremde manuelle Steuerung: Gerät steht im manuellen Modus, ohne dass aktuelle
 * EMS-Ownership nachweisbar ist. EMS darf das nicht ungefragt überschreiben.
 */
function isForeignManualControl(input) {
    return input.currentMode === input.manualModeValue && !input.ownership.active;
}
exports.isForeignManualControl = isForeignManualControl;

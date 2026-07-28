"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isImmersionReheatHysteresisActive = void 0;
/**
 * Wiedereinschalt-Hysterese nach erreichtem Auto-Tagesziel — gleiche Regel für Runtime-FSM
 * und Operator-Contribution, damit der Daily Plan keine Slots vergibt, die die Runtime sperrt.
 */
function isImmersionReheatHysteresisActive(input) {
    if (input.bufferTempC === null || !Number.isFinite(input.bufferTempC))
        return false;
    if (!Number.isFinite(input.targetTempC))
        return false;
    const hyst = Math.max(0, input.hysteresisK);
    const reheatThresholdC = input.targetTempC - hyst;
    if (input.bufferTempC < reheatThresholdC)
        return false;
    return input.autoTargetReached === true || input.bufferTempC >= input.targetTempC;
}
exports.isImmersionReheatHysteresisActive = isImmersionReheatHysteresisActive;

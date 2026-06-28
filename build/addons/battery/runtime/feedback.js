"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkChargeFeedback = exports.chargeWithinTolerance = exports.checkModeFeedback = void 0;
function checkModeFeedback(input) {
    if (input.actualMode !== null && input.actualMode === input.expectedMode) {
        return "ok";
    }
    if (input.elapsedMs >= input.timeoutMs) {
        return "timeout";
    }
    return "pending";
}
exports.checkModeFeedback = checkModeFeedback;
function chargeWithinTolerance(expectedW, actualW, tolerance) {
    const allowed = Math.max(tolerance.absoluteW, (Math.abs(expectedW) * tolerance.relativePct) / 100);
    return Math.abs(actualW - expectedW) <= allowed;
}
exports.chargeWithinTolerance = chargeWithinTolerance;
function checkChargeFeedback(input) {
    if (input.actualChargingW !== null && chargeWithinTolerance(input.expectedW, input.actualChargingW, input.tolerance)) {
        return "ok";
    }
    if (input.elapsedMs >= input.timeoutMs) {
        return "timeout";
    }
    return "pending";
}
exports.checkChargeFeedback = checkChargeFeedback;

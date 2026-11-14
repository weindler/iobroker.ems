"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkModeFeedback = checkModeFeedback;
exports.chargeWithinTolerance = chargeWithinTolerance;
exports.checkChargeFeedback = checkChargeFeedback;
function checkModeFeedback(input) {
    if (input.actualMode !== null && input.actualMode === input.expectedMode) {
        return "ok";
    }
    if (input.elapsedMs >= input.timeoutMs) {
        return "timeout";
    }
    return "pending";
}
function chargeWithinTolerance(expectedW, actualW, tolerance) {
    const allowed = Math.max(tolerance.absoluteW, (Math.abs(expectedW) * tolerance.relativePct) / 100);
    return Math.abs(actualW - expectedW) <= allowed;
}
function checkChargeFeedback(input) {
    if (input.actualChargingW !== null && chargeWithinTolerance(input.expectedW, input.actualChargingW, input.tolerance)) {
        return "ok";
    }
    if (input.elapsedMs >= input.timeoutMs) {
        return "timeout";
    }
    return "pending";
}

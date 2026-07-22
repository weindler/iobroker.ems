"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.faultCodeForFeedbackStatus = exports.clearWallboxFault = exports.raiseWallboxFault = exports.emptyWallboxFault = void 0;
function emptyWallboxFault() {
    return { active: false, code: null, since: null, message: null };
}
exports.emptyWallboxFault = emptyWallboxFault;
function raiseWallboxFault(code, message, nowIso) {
    return { active: true, code, since: nowIso, message };
}
exports.raiseWallboxFault = raiseWallboxFault;
function clearWallboxFault() {
    return emptyWallboxFault();
}
exports.clearWallboxFault = clearWallboxFault;
/** Feedback-Aggregatstatus → Fault-Code, sofern es sich um ein echtes Problem handelt (nicht "pending"). */
function faultCodeForFeedbackStatus(status) {
    if (status === "mismatch")
        return "feedback_mismatch";
    if (status === "timeout")
        return "feedback_timeout";
    if (status === "invalid")
        return "feedback_invalid";
    return null;
}
exports.faultCodeForFeedbackStatus = faultCodeForFeedbackStatus;

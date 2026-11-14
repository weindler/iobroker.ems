"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyWallboxFault = emptyWallboxFault;
exports.raiseWallboxFault = raiseWallboxFault;
exports.clearWallboxFault = clearWallboxFault;
exports.faultCodeForFeedbackStatus = faultCodeForFeedbackStatus;
function emptyWallboxFault() {
    return { active: false, code: null, since: null, message: null };
}
function raiseWallboxFault(code, message, nowIso) {
    return { active: true, code, since: nowIso, message };
}
function clearWallboxFault() {
    return emptyWallboxFault();
}
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

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCleaningFinishedByFeedback = exports.isCleaningOperatingActive = exports.normalizeCleaningToken = exports.CLEANING_RUNNING_OPERATING = void 0;
/** SmartThings custom.autoCleaningMode — operatingState während Reinigung. */
exports.CLEANING_RUNNING_OPERATING = ["autoclean", "speedclean", "quietclean", "timedclean"];
function normalizeCleaningToken(raw) {
    return String(raw ?? "").trim().toLowerCase();
}
exports.normalizeCleaningToken = normalizeCleaningToken;
function isCleaningOperatingActive(raw) {
    const token = normalizeCleaningToken(raw);
    return exports.CLEANING_RUNNING_OPERATING.includes(token);
}
exports.isCleaningOperatingActive = isCleaningOperatingActive;
function isCleaningFinishedByFeedback(input) {
    if (!input.sawOperatingActive) {
        return false;
    }
    const op = normalizeCleaningToken(input.operatingStateRaw);
    const mode = normalizeCleaningToken(input.modeRaw);
    if (op === "ready") {
        return true;
    }
    return mode === "off";
}
exports.isCleaningFinishedByFeedback = isCleaningFinishedByFeedback;

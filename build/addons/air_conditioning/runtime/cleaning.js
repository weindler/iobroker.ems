"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCleaningFinishedByFeedback = exports.shouldMarkCleaningOperatingActive = exports.isCleaningOperatingActive = exports.normalizeCleaningToken = exports.CLEANING_RUNNING_OPERATING = void 0;
const constants_1 = require("../constants");
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
function shouldMarkCleaningOperatingActive(raw, elapsedSec) {
    return elapsedSec >= constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC && isCleaningOperatingActive(raw);
}
exports.shouldMarkCleaningOperatingActive = shouldMarkCleaningOperatingActive;
function isCleaningFinishedByFeedback(input) {
    if (!input.sawOperatingActive || input.elapsedSec < constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC) {
        return false;
    }
    const op = normalizeCleaningToken(input.operatingStateRaw);
    const mode = normalizeCleaningToken(input.modeRaw);
    if (mode === "off" && input.elapsedSec >= constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC) {
        return true;
    }
    if (op === "ready" && input.elapsedSec >= constants_1.AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC) {
        return true;
    }
    return false;
}
exports.isCleaningFinishedByFeedback = isCleaningFinishedByFeedback;

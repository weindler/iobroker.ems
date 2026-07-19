"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCleaningStuckNeverEngaged = exports.isCleaningFinishedByFeedback = exports.isCleaningFinishedByProgress = exports.shouldMarkCleaningProgressActive = exports.shouldMarkCleaningOperatingActive = exports.isCleaningOperatingActive = exports.normalizeCleaningProgressPct = exports.normalizeCleaningToken = exports.CLEANING_RUNNING_OPERATING = void 0;
const constants_1 = require("../constants");
/** SmartThings custom.autoCleaningMode — operatingState während Reinigung. */
exports.CLEANING_RUNNING_OPERATING = ["autoclean", "speedclean", "quietclean", "timedclean"];
function normalizeCleaningToken(raw) {
    return String(raw ?? "").trim().toLowerCase();
}
exports.normalizeCleaningToken = normalizeCleaningToken;
function normalizeCleaningProgressPct(raw) {
    if (raw == null || raw === "") {
        return null;
    }
    const token = String(raw).trim().replace(/%$/, "");
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
}
exports.normalizeCleaningProgressPct = normalizeCleaningProgressPct;
function isCleaningOperatingActive(raw) {
    const token = normalizeCleaningToken(raw);
    return exports.CLEANING_RUNNING_OPERATING.includes(token);
}
exports.isCleaningOperatingActive = isCleaningOperatingActive;
function shouldMarkCleaningOperatingActive(raw, elapsedSec) {
    return elapsedSec >= constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC && isCleaningOperatingActive(raw);
}
exports.shouldMarkCleaningOperatingActive = shouldMarkCleaningOperatingActive;
function shouldMarkCleaningProgressActive(progressPct) {
    return progressPct != null && progressPct > 0 && progressPct < 100;
}
exports.shouldMarkCleaningProgressActive = shouldMarkCleaningProgressActive;
/** Primäres Ende-Signal: SmartThings progress = 100 %. */
function isCleaningFinishedByProgress(input) {
    const progress = input.progressPct;
    if (progress == null || progress < 100 || input.elapsedSec < constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC) {
        return false;
    }
    if (input.sawProgressActive || input.sawOperatingActive) {
        return true;
    }
    const start = input.startProgressPct;
    return start != null && progress > start;
}
exports.isCleaningFinishedByProgress = isCleaningFinishedByProgress;
/** Fallback wenn kein Fortschritt gemappt oder progress hängt. */
function isCleaningFinishedByFeedback(input) {
    if (!input.sawOperatingActive || input.elapsedSec < constants_1.AC_CLEANING_ACTIVE_CONFIRM_SEC) {
        return false;
    }
    const op = normalizeCleaningToken(input.operatingStateRaw);
    const mode = normalizeCleaningToken(input.modeRaw);
    if (mode === "off") {
        return true;
    }
    if (op === "ready" && input.elapsedSec >= constants_1.AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC) {
        return true;
    }
    return false;
}
exports.isCleaningFinishedByFeedback = isCleaningFinishedByFeedback;
/** Reinigung nie wirklich gestartet (ready + kein autoclean/progress) → Flag freigeben. */
function isCleaningStuckNeverEngaged(input) {
    if (input.sawOperatingActive || input.sawProgressActive) {
        return false;
    }
    if (input.elapsedSec < constants_1.AC_CLEANING_STUCK_ABORT_SEC) {
        return false;
    }
    const op = normalizeCleaningToken(input.operatingStateRaw);
    return op === "ready" || op === "" || op === "idle";
}
exports.isCleaningStuckNeverEngaged = isCleaningStuckNeverEngaged;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeAcUnitStatsSession = exports.acStatsDeviceActive = exports.AC_STATS_START_FEEDBACK_GRACE_MS = void 0;
const constants_1 = require("../constants");
/** Grace after start while feedback_switch may still be off. */
exports.AC_STATS_START_FEEDBACK_GRACE_MS = constants_1.AC_FEEDBACK_POLL_MS * constants_1.AC_FEEDBACK_POLL_ATTEMPTS + 5_000;
/**
 * Statistik: zählen ab Start-Sequenz bis Stopp bestätigt (auch wenn feedback_switch kurz nachzieht).
 * Ohne bestätigtes Feedback und ohne Dryrun-Session endet das Sticky nach der Start-Grace —
 * sonst läuft die Statistik weiter, obwohl das Gerät längst aus ist (z. B. nach Deaktivieren/Reaktivieren).
 */
function acStatsDeviceActive(up, fbOn, upRunning, nowMs = Date.now(), startGraceMs = exports.AC_STATS_START_FEEDBACK_GRACE_MS) {
    if (fbOn)
        return true;
    if (upRunning)
        return true;
    if (!up.lastStartAtMs)
        return false;
    const stoppedAfterStart = up.lastStopAtMs != null && up.lastStopAtMs >= up.lastStartAtMs;
    if (stoppedAfterStart)
        return false;
    // Sticky only during short feedback lag after EMS start — not forever.
    return nowMs - up.lastStartAtMs <= startGraceMs;
}
exports.acStatsDeviceActive = acStatsDeviceActive;
/** Close an open stats/runtime session (e.g. unit disabled in Admin). */
function closeAcUnitStatsSession(up, nowMs) {
    const open = up.running ||
        (up.lastStartAtMs != null &&
            (up.lastStopAtMs == null || up.lastStopAtMs < up.lastStartAtMs));
    if (!open)
        return false;
    up.running = false;
    if (up.lastStartAtMs == null) {
        up.lastStartAtMs = nowMs;
    }
    up.lastStopAtMs = nowMs;
    return true;
}
exports.closeAcUnitStatsSession = closeAcUnitStatsSession;

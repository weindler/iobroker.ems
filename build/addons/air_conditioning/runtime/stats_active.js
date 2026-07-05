"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acStatsDeviceActive = void 0;
/** Statistik: zählen ab Start-Sequenz bis Stopp bestätigt (auch wenn feedback_switch nachzieht). */
function acStatsDeviceActive(up, fbOn, upRunning) {
    if (fbOn)
        return true;
    if (upRunning)
        return true;
    if (!up.lastStartAtMs)
        return false;
    const stoppedAfterStart = up.lastStopAtMs != null && up.lastStopAtMs >= up.lastStartAtMs;
    return !stoppedAfterStart;
}
exports.acStatsDeviceActive = acStatsDeviceActive;

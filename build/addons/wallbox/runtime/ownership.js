"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyWallboxOwnership = emptyWallboxOwnership;
exports.grantWallboxOwnership = grantWallboxOwnership;
exports.canSafeRestoreWallbox = canSafeRestoreWallbox;
function emptyWallboxOwnership() {
    return { active: false, controlModel: "none", startedAt: null, writeScenario: null };
}
function grantWallboxOwnership(controlModel, writeScenario, nowIso) {
    return { active: true, controlModel, startedAt: nowIso, writeScenario };
}
/** Safe Restore ist nur sinnvoll, wenn EMS die Kontrolle nachweislich selbst übernommen hat. */
function canSafeRestoreWallbox(ownership) {
    return ownership.active && ownership.controlModel !== "none";
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canSafeRestoreWallbox = exports.grantWallboxOwnership = exports.emptyWallboxOwnership = void 0;
function emptyWallboxOwnership() {
    return { active: false, controlModel: "none", startedAt: null, writeScenario: null };
}
exports.emptyWallboxOwnership = emptyWallboxOwnership;
function grantWallboxOwnership(controlModel, writeScenario, nowIso) {
    return { active: true, controlModel, startedAt: nowIso, writeScenario };
}
exports.grantWallboxOwnership = grantWallboxOwnership;
/** Safe Restore ist nur sinnvoll, wenn EMS die Kontrolle nachweislich selbst übernommen hat. */
function canSafeRestoreWallbox(ownership) {
    return ownership.active && ownership.controlModel !== "none";
}
exports.canSafeRestoreWallbox = canSafeRestoreWallbox;

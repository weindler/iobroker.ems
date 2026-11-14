"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRestoreInProgress = isRestoreInProgress;
exports.setRestoreInProgress = setRestoreInProgress;
exports.isRestoreRestartRequired = isRestoreRestartRequired;
exports.setRestoreRestartRequired = setRestoreRestartRequired;
exports.resetRestoreBarrierForTest = resetRestoreBarrierForTest;
exports.assertDeviceActionAllowed = assertDeviceActionAllowed;
let restoreInProgress = false;
let restartRequired = false;
function isRestoreInProgress() {
    return restoreInProgress;
}
function setRestoreInProgress(active) {
    restoreInProgress = active;
}
function isRestoreRestartRequired() {
    return restartRequired;
}
function setRestoreRestartRequired(active) {
    restartRequired = active;
}
function resetRestoreBarrierForTest() {
    restoreInProgress = false;
    restartRequired = false;
}
function assertDeviceActionAllowed() {
    if (restoreInProgress) {
        return { ok: false, reason: "restore_in_progress" };
    }
    return { ok: true };
}

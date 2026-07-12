"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertDeviceActionAllowed = exports.resetRestoreBarrierForTest = exports.setRestoreRestartRequired = exports.isRestoreRestartRequired = exports.setRestoreInProgress = exports.isRestoreInProgress = void 0;
let restoreInProgress = false;
let restartRequired = false;
function isRestoreInProgress() {
    return restoreInProgress;
}
exports.isRestoreInProgress = isRestoreInProgress;
function setRestoreInProgress(active) {
    restoreInProgress = active;
}
exports.setRestoreInProgress = setRestoreInProgress;
function isRestoreRestartRequired() {
    return restartRequired;
}
exports.isRestoreRestartRequired = isRestoreRestartRequired;
function setRestoreRestartRequired(active) {
    restartRequired = active;
}
exports.setRestoreRestartRequired = setRestoreRestartRequired;
function resetRestoreBarrierForTest() {
    restoreInProgress = false;
    restartRequired = false;
}
exports.resetRestoreBarrierForTest = resetRestoreBarrierForTest;
function assertDeviceActionAllowed() {
    if (restoreInProgress) {
        return { ok: false, reason: "restore_in_progress" };
    }
    return { ok: true };
}
exports.assertDeviceActionAllowed = assertDeviceActionAllowed;

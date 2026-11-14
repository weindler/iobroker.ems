"use strict";
/** Transient Dryrun-Zwang für einen Bootstrap-/Recovery-Lauf (kein dauerhaftes Modul-Global). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPendingForceDryrunReason = setPendingForceDryrunReason;
exports.getPendingForceDryrunReason = getPendingForceDryrunReason;
exports.clearPendingForceDryrunReason = clearPendingForceDryrunReason;
exports.resetRestoreDryrunContextForTest = resetRestoreDryrunContextForTest;
let pendingForceDryrunReason = null;
function setPendingForceDryrunReason(reason) {
    pendingForceDryrunReason = reason;
}
function getPendingForceDryrunReason() {
    return pendingForceDryrunReason;
}
function clearPendingForceDryrunReason() {
    pendingForceDryrunReason = null;
}
function resetRestoreDryrunContextForTest() {
    pendingForceDryrunReason = null;
}

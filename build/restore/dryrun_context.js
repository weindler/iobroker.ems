"use strict";
/** Transient Dryrun-Zwang für einen Bootstrap-/Recovery-Lauf (kein dauerhaftes Modul-Global). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetRestoreDryrunContextForTest = exports.clearPendingForceDryrunReason = exports.getPendingForceDryrunReason = exports.setPendingForceDryrunReason = void 0;
let pendingForceDryrunReason = null;
function setPendingForceDryrunReason(reason) {
    pendingForceDryrunReason = reason;
}
exports.setPendingForceDryrunReason = setPendingForceDryrunReason;
function getPendingForceDryrunReason() {
    return pendingForceDryrunReason;
}
exports.getPendingForceDryrunReason = getPendingForceDryrunReason;
function clearPendingForceDryrunReason() {
    pendingForceDryrunReason = null;
}
exports.clearPendingForceDryrunReason = clearPendingForceDryrunReason;
function resetRestoreDryrunContextForTest() {
    pendingForceDryrunReason = null;
}
exports.resetRestoreDryrunContextForTest = resetRestoreDryrunContextForTest;
